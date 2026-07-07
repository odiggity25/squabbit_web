import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

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
const detailView = document.getElementById('detail-view');

// All rows loaded for the list view, so the search box can filter client-side.
let loadedRows = [];

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

// Once verified as a sysAdmin, reveal the content and route to list or detail
// based on the ?id= query param.
function showAdmin(email) {
    loading.style.display = 'none';
    loginSection.style.display = 'none';
    adminContent.style.display = 'block';
    signedInAs.textContent = email;

    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get('id');
    if (conversationId) {
        detailView.classList.remove('d-none');
        listView.classList.add('d-none');
        loadDetail(conversationId);
    } else {
        listView.classList.remove('d-none');
        detailView.classList.add('d-none');
        loadList();
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

// ----- LIST VIEW -----

async function loadList() {
    const tbody = document.getElementById('chats-tbody');
    const listResult = document.getElementById('list-result');
    listResult.classList.add('d-none');
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted small">Loading...</td></tr>';
    try {
        const q = query(collection(db, COLLECTION), orderBy('updatedAt', 'desc'), limit(100));
        const snapshot = await getDocs(q);
        loadedRows = snapshot.docs.map((docSnap) => {
            const data = docSnap.data() || {};
            return {
                id: docSnap.id,
                title: data.title || '(untitled)',
                groupType: data.groupType || '',
                groupId: data.groupId || '',
                messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
                proposedActionsCount: data.proposedActionsCount != null ? data.proposedActionsCount : 0,
                actionsAppliedCount: data.actionsAppliedCount != null ? data.actionsAppliedCount : '',
                updatedAt: data.updatedAt,
                updatedAtText: formatTimestamp(data.updatedAt),
            };
        });
        if (loadedRows.length === 0) {
            listResult.className = 'alert alert-info';
            listResult.textContent = 'No conversations found.';
            listResult.classList.remove('d-none');
        }
        renderListRows(loadedRows);
    } catch (e) {
        listResult.className = 'alert alert-danger';
        listResult.textContent = 'Error loading conversations: ' + (e.message || e);
        listResult.classList.remove('d-none');
        tbody.innerHTML = '';
    }
}

function renderListRows(rows) {
    const tbody = document.getElementById('chats-tbody');
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-muted small">No matching conversations.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    for (const row of rows) {
        const tr = document.createElement('tr');
        const href = 'adminAiChats.html?id=' + encodeURIComponent(row.id);
        tr.addEventListener('click', () => { window.location.href = href; });
        tr.innerHTML =
            '<td><a href="' + escapeHtml(href) + '" class="text-decoration-none">' + escapeHtml(row.title) + '</a></td>'
            + '<td>' + escapeHtml(row.groupType) + '</td>'
            + '<td style="word-break:break-all;">' + escapeHtml(row.groupId) + '</td>'
            + '<td class="text-end">' + row.messageCount + '</td>'
            + '<td class="text-end">' + escapeHtml(row.proposedActionsCount) + '</td>'
            + '<td class="text-end">' + escapeHtml(row.actionsAppliedCount) + '</td>'
            + '<td>' + escapeHtml(row.updatedAtText) + '</td>';
        tbody.appendChild(tr);
    }
}

function applyListFilter() {
    const term = document.getElementById('chat-search').value.trim().toLowerCase();
    if (!term) {
        renderListRows(loadedRows);
        return;
    }
    const filtered = loadedRows.filter((row) =>
        (row.title || '').toLowerCase().includes(term)
        || (row.groupId || '').toLowerCase().includes(term));
    renderListRows(filtered);
}

// ----- DETAIL VIEW -----

async function loadDetail(conversationId) {
    const header = document.getElementById('detail-header');
    const transcript = document.getElementById('detail-transcript');
    const detailResult = document.getElementById('detail-result');
    detailResult.classList.add('d-none');
    header.innerHTML = '<p class="text-muted small mb-0">Loading...</p>';
    transcript.innerHTML = '';
    try {
        const docSnap = await getDoc(doc(db, COLLECTION, conversationId));
        if (!docSnap.exists()) {
            detailResult.className = 'alert alert-warning';
            detailResult.textContent = 'Conversation not found: ' + conversationId;
            detailResult.classList.remove('d-none');
            header.innerHTML = '';
            return;
        }
        const data = docSnap.data() || {};
        renderDetailHeader(header, conversationId, data);
        renderTranscript(transcript, Array.isArray(data.messages) ? data.messages : []);
    } catch (e) {
        detailResult.className = 'alert alert-danger';
        detailResult.textContent = 'Error loading conversation: ' + (e.message || e);
        detailResult.classList.remove('d-none');
        header.innerHTML = '';
    }
}

function renderDetailHeader(header, conversationId, data) {
    const facts = [
        ['Conversation id', conversationId],
        ['User id', data.userId || ''],
        ['Mode', data.mode || ''],
        ['Group type', data.groupType || ''],
        ['Group id', data.groupId || ''],
        ['Created', formatTimestamp(data.createdAt)],
        ['Updated', formatTimestamp(data.updatedAt)],
        ['Proposed actions', data.proposedActionsCount != null ? data.proposedActionsCount : 0],
        ['Actions applied', data.actionsAppliedCount != null ? data.actionsAppliedCount : '—'],
    ];
    let html = '<h5 class="mb-3">' + escapeHtml(data.title || '(untitled)') + '</h5>';
    html += '<div class="row g-2">';
    for (const [label, value] of facts) {
        html += '<div class="col-md-6 header-fact"><span class="label">' + escapeHtml(label)
            + ':</span><span style="word-break:break-all;">' + escapeHtml(value) + '</span></div>';
    }
    html += '</div>';
    header.innerHTML = html;
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
