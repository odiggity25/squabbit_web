import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

// Same Firebase config + modular SDK (v11.0.1) as admin.js. This page is a
// sysAdmin-only read-only viewer for the `aiChatConversations` collection.
const firebaseConfig = {
    apiKey: 'AIzaSyDGVjvgrebAuRyRHOrztVLhRaUCP0N6TVM',
    appId: '1:535750845572:web:46e4c26866e4ef23584ed1',
    messagingSenderId: '535750845572',
    projectId: 'squabbit-2019',
    storageBucket: 'squabbit-2019.appspot.com',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);
const db = getFirestore(app);

const COLLECTION = 'aiChatConversations';

const loginSection = document.getElementById('login-section');
const adminContent = document.getElementById('admin-content');
const loading = document.getElementById('loading');
const loginError = document.getElementById('login-error');
const signedInAs = document.getElementById('signed-in-as');
const listView = document.getElementById('list-view');

const PAGE_SIZE = 25;

// Rows on the current page (full document data, so accordion expansion is
// rendered locally with no extra fetch). The search box filters these.
let currentRows = [];
// pageCursors[i] = last document snapshot of page i, used as the startAfter
// cursor when loading page i + 1. Enables Prev by re-running earlier pages.
let pageCursors = [];
let currentPage = 0;
let hasNextPage = false;

function showLogin() {
    loading.style.display = 'none';
    loginSection.style.display = 'block';
    adminContent.style.display = 'none';
}

function showLoading() {
    loading.style.display = 'block';
    loginSection.style.display = 'none';
    adminContent.style.display = 'none';
}

// Once verified as a sysAdmin, reveal the content. A ?id= deep link renders
// that single conversation pre-expanded; otherwise show page 1 of the list.
function showAdmin(email) {
    loading.style.display = 'none';
    loginSection.style.display = 'none';
    adminContent.style.display = 'block';
    signedInAs.textContent = email;
    listView.classList.remove('d-none');

    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get('id');
    if (conversationId) {
        loadSingle(conversationId);
    } else {
        loadPage(0);
    }
}

// Renders a Firestore Timestamp (or a {seconds}/{_seconds} plain object, or a
// millis number, or an ISO string) as a human-readable local date-time.
function formatTimestamp(value) {
    if (value == null) return '';
    let date = null;
    if (typeof value.toDate === 'function') {
        date = value.toDate();
    } else if (typeof value === 'object' && (value.seconds != null || value._seconds != null)) {
        const seconds = value.seconds != null ? value.seconds : value._seconds;
        date = new Date(seconds * 1000);
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value === 'string') {
        date = new Date(value);
    }
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// ----- LIST VIEW (paginated accordion) -----

async function loadPage(pageIndex) {
    const accordion = document.getElementById('chats-accordion');
    const listResult = document.getElementById('list-result');
    listResult.classList.add('d-none');
    accordion.innerHTML = '<p class="text-muted small mb-0">Loading...</p>';
    setPagerEnabled(false);
    try {
        const constraints = [orderBy('updatedAt', 'desc')];
        if (pageIndex > 0) constraints.push(startAfter(pageCursors[pageIndex - 1]));
        // Fetch one extra doc purely to know whether a next page exists.
        constraints.push(limit(PAGE_SIZE + 1));
        const snapshot = await getDocs(query(collection(db, COLLECTION), ...constraints));
        hasNextPage = snapshot.docs.length > PAGE_SIZE;
        const docs = snapshot.docs.slice(0, PAGE_SIZE);
        if (docs.length > 0) pageCursors[pageIndex] = docs[docs.length - 1];
        currentPage = pageIndex;
        currentRows = docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }));
        if (currentRows.length === 0 && pageIndex === 0) {
            listResult.className = 'alert alert-info';
            listResult.textContent = 'No conversations found.';
            listResult.classList.remove('d-none');
        }
        applyListFilter();
        updatePager();
    } catch (e) {
        listResult.className = 'alert alert-danger';
        listResult.textContent = 'Error loading conversations: ' + (e.message || e);
        listResult.classList.remove('d-none');
        accordion.innerHTML = '';
        updatePager();
    }
}

function setPagerEnabled(enabled) {
    document.getElementById('prev-page-btn').disabled = !enabled || currentPage === 0;
    document.getElementById('next-page-btn').disabled = !enabled || !hasNextPage;
}

function updatePager() {
    document.getElementById('page-indicator').textContent = 'Page ' + (currentPage + 1);
    setPagerEnabled(true);
}

function renderAccordion(rows) {
    const accordion = document.getElementById('chats-accordion');
    accordion.innerHTML = '';
    if (rows.length === 0) {
        accordion.innerHTML = '<p class="text-muted small mb-0">No matching conversations on this page.</p>';
        return;
    }
    for (const row of rows) {
        accordion.appendChild(buildChatItem(row, false));
    }
}

// One accordion item per conversation. The transcript body is rendered
// lazily on first expand (the data is already in memory from the page query).
function buildChatItem(row, expanded) {
    const data = row.data;
    const item = document.createElement('div');
    item.className = 'chat-item';

    const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
    const proposed = data.proposedActionsCount != null ? data.proposedActionsCount : 0;
    const applied = data.actionsAppliedCount != null ? data.actionsAppliedCount : '';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'chat-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML =
        '<span class="chat-title">' + escapeHtml(data.title || '(untitled)') + '</span>'
        + '<span class="chat-col hide-sm">' + escapeHtml(data.groupType || '') + '</span>'
        + '<span class="chat-col num hide-sm">' + messageCount + '</span>'
        + '<span class="chat-col num hide-sm">' + escapeHtml(proposed) + '</span>'
        + '<span class="chat-col num hide-sm">' + escapeHtml(applied) + '</span>'
        + '<span class="chat-col">' + escapeHtml(formatTimestamp(data.updatedAt)) + '</span>'
        + '<span class="chat-chevron">&#9654;</span>';

    const body = document.createElement('div');
    body.className = 'chat-body';

    const ensureBodyRendered = () => {
        if (body.dataset.rendered) return;
        body.dataset.rendered = '1';
        renderChatBody(body, row.id, data);
    };

    toggle.addEventListener('click', () => {
        const open = item.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) ensureBodyRendered();
    });

    item.appendChild(toggle);
    item.appendChild(body);

    if (expanded) {
        item.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        ensureBodyRendered();
    }
    return item;
}

function renderChatBody(body, conversationId, data) {
    const facts = [
        ['Conversation id', conversationId],
        ['User id', data.userId || ''],
        ['Mode', data.mode || ''],
        ['Group type', data.groupType || ''],
        ['Group id', data.groupId || ''],
        ['Created', formatTimestamp(data.createdAt)],
        ['Updated', formatTimestamp(data.updatedAt)],
        ['Proposed actions', data.proposedActionsCount != null ? data.proposedActionsCount : 0],
        ['Actions applied', data.actionsAppliedCount != null ? data.actionsAppliedCount : '(none)'],
    ];
    body.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'd-flex justify-content-end mb-2';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-outline-secondary btn-sm';
    copyBtn.textContent = 'Copy conversation';
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(buildConversationText(conversationId, data));
            copyBtn.textContent = 'Copied';
        } catch (e) {
            copyBtn.textContent = 'Copy failed';
        }
        setTimeout(() => { copyBtn.textContent = 'Copy conversation'; }, 1500);
    });
    toolbar.appendChild(copyBtn);
    body.appendChild(toolbar);

    let html = '<div class="row g-2">';
    for (const [label, value] of facts) {
        html += '<div class="col-md-6 header-fact"><span class="label">' + escapeHtml(label)
            + ':</span><span style="word-break:break-all;">' + escapeHtml(value) + '</span></div>';
    }
    html += '</div>';
    const factsDiv = document.createElement('div');
    factsDiv.className = 'chat-facts';
    factsDiv.innerHTML = html;
    body.appendChild(factsDiv);

    const transcript = document.createElement('div');
    body.appendChild(transcript);
    renderTranscript(transcript, Array.isArray(data.messages) ? data.messages : []);
}

// Plain-text rendering of a conversation, suitable for pasting into a Claude
// session when investigating a bad AI reply.
function buildConversationText(conversationId, data) {
    const lines = [];
    lines.push('AI chat conversation: ' + (data.title || '(untitled)'));
    lines.push('Conversation id: ' + conversationId);
    if (data.mode) lines.push('Mode: ' + data.mode);
    if (data.groupType) lines.push('Group type: ' + data.groupType);
    if (data.groupId) lines.push('Group id: ' + data.groupId);
    lines.push('');
    const messages = Array.isArray(data.messages) ? data.messages : [];
    for (const message of messages) {
        const role = message.role === 'user' ? 'USER' : 'ASSISTANT';
        let headerLine = '--- ' + role;
        const ts = formatTimestamp(message.ts);
        if (ts) headerLine += ' (' + ts + ')';
        if (message.feedback === 'up') headerLine += ' [feedback: thumbs up]';
        else if (message.feedback === 'down') headerLine += ' [feedback: thumbs down]';
        headerLine += ' ---';
        lines.push(headerLine);
        lines.push(message.content || '');
        if (role === 'ASSISTANT' && Array.isArray(message.actions) && message.actions.length > 0) {
            lines.push('');
            lines.push('Proposed actions (status: ' + (message.batchStatus || 'none') + '):');
            let actionsJson;
            try { actionsJson = JSON.stringify(message.actions, null, 2); }
            catch (e) { actionsJson = String(message.actions); }
            lines.push(actionsJson);
        }
        lines.push('');
    }
    return lines.join('\n');
}

function applyListFilter() {
    const term = document.getElementById('chat-search').value.trim().toLowerCase();
    if (!term) {
        renderAccordion(currentRows);
        return;
    }
    const filtered = currentRows.filter((row) =>
        (row.data.title || '').toLowerCase().includes(term)
        || (row.data.groupId || '').toLowerCase().includes(term));
    renderAccordion(filtered);
}

// ----- DEEP LINK (?id=) -----

// Renders a single conversation as one pre-expanded accordion item, with the
// pager/search/header row hidden and a link back to the full list.
async function loadSingle(conversationId) {
    const accordion = document.getElementById('chats-accordion');
    const listResult = document.getElementById('list-result');
    document.getElementById('show-all-link').classList.remove('d-none');
    document.getElementById('pager').classList.add('d-none');
    document.getElementById('chat-list-header').classList.add('d-none');
    document.getElementById('chat-search').classList.add('d-none');
    listResult.classList.add('d-none');
    accordion.innerHTML = '<p class="text-muted small mb-0">Loading...</p>';
    try {
        const docSnap = await getDoc(doc(db, COLLECTION, conversationId));
        if (!docSnap.exists()) {
            listResult.className = 'alert alert-warning';
            listResult.textContent = 'Conversation not found: ' + conversationId;
            listResult.classList.remove('d-none');
            accordion.innerHTML = '';
            return;
        }
        accordion.innerHTML = '';
        accordion.appendChild(buildChatItem({ id: docSnap.id, data: docSnap.data() || {} }, true));
    } catch (e) {
        listResult.className = 'alert alert-danger';
        listResult.textContent = 'Error loading conversation: ' + (e.message || e);
        listResult.classList.remove('d-none');
        accordion.innerHTML = '';
    }
}

function renderTranscript(container, messages) {
    if (messages.length === 0) {
        container.innerHTML = '<p class="text-muted small">No messages.</p>';
        return;
    }
    container.innerHTML = '';
    for (const message of messages) {
        const role = message.role === 'user' ? 'user' : 'assistant';
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ' + role;

        let inner = '<div class="chat-role">' + escapeHtml(role);
        if (message.feedback === 'up') inner += '<span class="feedback-icon">👍</span>';
        else if (message.feedback === 'down') inner += '<span class="feedback-icon">👎</span>';
        inner += '</div>';

        inner += '<div>' + escapeHtml(message.content || '') + '</div>';

        // Assistant proposed actions + batch status.
        if (role === 'assistant' && Array.isArray(message.actions) && message.actions.length > 0) {
            const status = (message.batchStatus || 'none').toLowerCase();
            let chipClass = 'none';
            if (status === 'applied') chipClass = 'applied';
            else if (status === 'declined' || status === 'failed') chipClass = status;
            else if (status === 'pending') chipClass = 'pending';
            const chipLabel = message.batchStatus ? message.batchStatus : 'none';

            inner += '<div class="actions-block">';
            inner += '<div><span class="fw-semibold small">Proposed actions</span> '
                + '<span class="status-chip ' + chipClass + '">' + escapeHtml(chipLabel) + '</span></div>';
            let actionsJson;
            try { actionsJson = JSON.stringify(message.actions, null, 2); }
            catch (e) { actionsJson = String(message.actions); }
            inner += '<pre>' + escapeHtml(actionsJson) + '</pre>';
            inner += '</div>';
        }

        // Links, if present.
        if (Array.isArray(message.links) && message.links.length > 0) {
            inner += '<div class="actions-block links-block"><div class="fw-semibold small">Links</div>';
            for (const link of message.links) {
                const url = typeof link === 'string' ? link : (link && (link.url || link.href)) || '';
                const text = typeof link === 'string' ? link : (link && (link.title || link.label)) || url;
                if (url) {
                    inner += '<div><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">'
                        + escapeHtml(text) + '</a></div>';
                } else {
                    let linkJson;
                    try { linkJson = JSON.stringify(link); } catch (e) { linkJson = String(link); }
                    inner += '<div class="small text-muted">' + escapeHtml(linkJson) + '</div>';
                }
            }
            inner += '</div>';
        }

        const tsText = formatTimestamp(message.ts);
        if (tsText) inner += '<div class="chat-meta">' + escapeHtml(tsText) + '</div>';

        bubble.innerHTML = inner;
        container.appendChild(bubble);
    }
}

// ----- AUTH GATE (same pattern as admin.js) -----

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        showLogin();
        return;
    }
    showLoading();
    try {
        const result = await httpsCallable(functions, 'verifySysAdmin')();
        if (result.data.isSysAdmin) {
            showAdmin(user.email);
        } else {
            loginError.textContent = 'Access denied — you are not a sysAdmin.';
            loginError.classList.remove('d-none');
            await signOut(auth);
            showLogin();
        }
    } catch (e) {
        loginError.textContent = 'Error verifying admin status: ' + e.message;
        loginError.classList.remove('d-none');
        await signOut(auth);
        showLogin();
    }
});

document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    loginError.classList.add('d-none');
    if (!email || !password) {
        loginError.textContent = 'Email and password are required.';
        loginError.classList.remove('d-none');
        return;
    }
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
        loginError.textContent = 'Sign in failed: ' + e.message;
        loginError.classList.remove('d-none');
    }
});

document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('sign-out-btn').addEventListener('click', () => signOut(auth));

document.getElementById('chat-search').addEventListener('input', applyListFilter);

document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (currentPage > 0) loadPage(currentPage - 1);
});

document.getElementById('next-page-btn').addEventListener('click', () => {
    if (hasNextPage) loadPage(currentPage + 1);
});
