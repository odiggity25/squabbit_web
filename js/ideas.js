import { auth, currentUser, requireUser, onUserChange, signOutUser } from './ideasAuth.js';
import {
    fetchIdeas, fetchOwnVotes, getUserDocId,
    statusBadge, categoryChip, escapeHtml, relativeTime,
    callable, uploadAttachment, showToast,
    STATUS_LABELS,
} from './ideasShared.js';

const state = {
    status: 'all',
    category: 'all',
    sort: 'top',
    search: '',
    ideas: [],
    voted: new Set(),
    userDocId: null,
    user: null,
    pendingAttachments: [],
};

const els = {
    list: document.getElementById('ideas-list'),
    submitBtn: document.getElementById('submit-btn'),
    badgeSlot: document.getElementById('user-badge-slot'),
    statsWrap: document.getElementById('ideas-stats'),
    statTotal: document.getElementById('stat-total'),
    statShipped: document.getElementById('stat-shipped'),
    backdrop: document.getElementById('submit-backdrop'),
    submitClose: document.getElementById('submit-close'),
    submitCancel: document.getElementById('submit-cancel'),
    submitConfirm: document.getElementById('submit-confirm'),
    submitError: document.getElementById('submit-error'),
    fTitle: document.getElementById('f-title'),
    fDescription: document.getElementById('f-description'),
    fCategory: document.getElementById('f-category'),
    fAttachments: document.getElementById('f-attachments'),
    attachUploader: document.getElementById('attach-uploader'),
    attachList: document.getElementById('attach-list'),
};

const callables = {
    submit: callable('submitFeatureRequest'),
    vote: callable('voteFeatureRequest'),
};

document.querySelectorAll('#status-pills .status-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#status-pills .status-pill').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.status = btn.dataset.status;
        load();
    });
});
document.querySelectorAll('.sort-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-tabs button').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.sort = btn.dataset.sort;
        load();
    });
});
document.getElementById('category-select').addEventListener('change', (e) => {
    state.category = e.target.value;
    load();
});

let searchTimer;
document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        renderList();
    }, 200);
});

els.submitBtn.addEventListener('click', async () => {
    const user = await requireUser();
    if (!user) return;
    openSubmit();
});

[els.submitClose, els.submitCancel].forEach((btn) => btn.addEventListener('click', closeSubmit));
els.backdrop.addEventListener('click', (e) => { if (e.target === els.backdrop) closeSubmit(); });

['title', 'description'].forEach((field) => {
    const input = els[`f${field[0].toUpperCase() + field.slice(1)}`];
    const counter = document.getElementById(`f-${field}-count`);
    input.addEventListener('input', () => { counter.textContent = input.value.length; });
});

els.fAttachments.addEventListener('change', (e) => handleFiles(e.target.files));
els.attachUploader.addEventListener('dragover', (e) => { e.preventDefault(); els.attachUploader.classList.add('is-drag'); });
els.attachUploader.addEventListener('dragleave', () => els.attachUploader.classList.remove('is-drag'));
els.attachUploader.addEventListener('drop', (e) => {
    e.preventDefault();
    els.attachUploader.classList.remove('is-drag');
    handleFiles(e.dataTransfer.files);
});

els.submitConfirm.addEventListener('click', submitIdea);

onUserChange(async (user) => {
    state.user = user;
    state.userDocId = user ? await getUserDocId(user.uid) : null;
    renderUserBadge();
    if (state.ideas.length > 0) {
        state.voted = user && state.userDocId
            ? await fetchOwnVotes(state.userDocId, state.ideas.map((i) => i.id))
            : new Set();
        renderList();
    }
});

async function load() {
    els.list.innerHTML = `<div class="ideas-skeleton">
        <div class="ideas-skeleton-card"></div>
        <div class="ideas-skeleton-card"></div>
        <div class="ideas-skeleton-card"></div>
    </div>`;
    try {
        state.ideas = await fetchIdeas({
            status: state.status, category: state.category, sort: state.sort,
        });
        if (state.user && state.userDocId) {
            state.voted = await fetchOwnVotes(state.userDocId, state.ideas.map((i) => i.id));
        } else {
            state.voted = new Set();
        }
        renderList();
        renderStats();
    } catch (err) {
        console.error('load error', err);
        els.list.innerHTML = `<div class="ideas-empty">
            <div class="icon"><i class="bi bi-exclamation-circle"></i></div>
            <h3>Could not load ideas</h3>
            <p>${escapeHtml(err.message || 'Please try again.')}</p>
        </div>`;
    }
}

function renderStats() {
    if (state.ideas.length === 0) {
        els.statsWrap.hidden = true;
        return;
    }
    els.statsWrap.hidden = false;
    els.statTotal.textContent = state.ideas.length;
    els.statShipped.textContent = state.ideas.filter((i) => i.status === 'shipped').length;
}

function renderList() {
    let ideas = state.ideas;
    if (state.search) {
        const n = state.search.toLowerCase();
        ideas = ideas.filter((i) =>
            (i.title || '').toLowerCase().includes(n) ||
            (i.description || '').toLowerCase().includes(n));
    }
    if (ideas.length === 0) {
        els.list.innerHTML = emptyHtml();
        return;
    }
    els.list.innerHTML = ideas.map(renderCard).join('');
    els.list.querySelectorAll('[data-vote]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleVote(btn.dataset.vote, btn);
        });
    });
}

function renderCard(idea) {
    const voted = state.voted.has(idea.id);
    const excerpt = (idea.description || '').slice(0, 220);
    const author = idea.authorName || 'Anonymous';
    const avatar = idea.authorAvatar || '/assets/icon_transparent.png';
    return `
        <article class="idea-card">
            <button class="vote-stack ${voted ? 'is-voted' : ''}" data-vote="${idea.id}" aria-label="Upvote">
                <span class="chev"><i class="bi bi-chevron-up"></i></span>
                <span class="num">${idea.voteCount ?? 0}</span>
            </button>
            <div class="idea-body">
                <div class="idea-title-row">
                    <a class="idea-title" href="/idea.html?id=${encodeURIComponent(idea.id)}">${escapeHtml(idea.title || 'Untitled')}</a>
                </div>
                ${excerpt ? `<p class="idea-excerpt">${escapeHtml(excerpt)}</p>` : ''}
                <div class="idea-meta">
                    ${statusBadge(idea.status || 'open')}
                    ${categoryChip(idea.category || 'other')}
                    <span class="idea-author">
                        <img src="${escapeHtml(avatar)}" alt="" onerror="this.src='/assets/icon_transparent.png'" />
                        ${escapeHtml(author)}
                    </span>
                    <span>${escapeHtml(relativeTime(idea.createdAt))}</span>
                    <span class="comment-count"><i class="bi bi-chat-left-text"></i>${idea.commentCount ?? 0}</span>
                </div>
            </div>
        </article>
    `;
}

function emptyHtml() {
    if (state.search) {
        return `<div class="ideas-empty">
            <div class="icon"><i class="bi bi-search"></i></div>
            <h3>No ideas match "${escapeHtml(state.search)}"</h3>
            <p>Try a different search or filter.</p>
        </div>`;
    }
    if (state.status !== 'all' || state.category !== 'all') {
        return `<div class="ideas-empty">
            <div class="icon"><i class="bi bi-funnel"></i></div>
            <h3>No ideas in this view</h3>
            <p>Try removing a filter, or be the first to post one.</p>
        </div>`;
    }
    return `<div class="ideas-empty">
        <div class="icon"><i class="bi bi-lightbulb"></i></div>
        <h3>No ideas yet</h3>
        <p>Be the first to share what we should build next.</p>
    </div>`;
}

async function handleVote(requestId, btn) {
    const user = await requireUser();
    if (!user) return;
    btn.classList.add('is-loading');
    try {
        const res = await callables.vote({ requestId });
        const data = res.data;
        const idea = state.ideas.find((i) => i.id === requestId);
        if (idea) idea.voteCount = data.voteCount;
        if (data.voted) state.voted.add(requestId);
        else state.voted.delete(requestId);
        const numEl = btn.querySelector('.num');
        if (numEl) numEl.textContent = data.voteCount;
        btn.classList.toggle('is-voted', data.voted);
    } catch (err) {
        showToast(err.message || 'Could not vote', { error: true });
    } finally {
        btn.classList.remove('is-loading');
    }
}

function renderUserBadge() {
    if (!state.user) {
        els.badgeSlot.innerHTML = '';
        return;
    }
    const photo = state.user.photoURL || '/assets/icon_transparent.png';
    const name = state.user.displayName || state.user.email;
    els.badgeSlot.innerHTML = `<span class="ideas-userbadge">
        <img src="${escapeHtml(photo)}" alt="" onerror="this.src='/assets/icon_transparent.png'" />
        ${escapeHtml(name)}
        <button class="btn-sq-text" id="signout-btn" style="padding:0.1rem 0.4rem;">Sign out</button>
    </span>`;
    document.getElementById('signout-btn').addEventListener('click', () => signOutUser());
}

function openSubmit() {
    els.submitError.hidden = true;
    els.fTitle.value = '';
    els.fDescription.value = '';
    els.fCategory.value = 'other';
    state.pendingAttachments = [];
    renderAttachments();
    document.getElementById('f-title-count').textContent = '0';
    document.getElementById('f-description-count').textContent = '0';
    els.backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => els.fTitle.focus(), 80);
}

function closeSubmit() {
    els.backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
}

async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const remaining = 5 - state.pendingAttachments.length;
    if (remaining <= 0) {
        showToast('You can attach up to 5 images.', { error: true });
        return;
    }
    const toUpload = files.slice(0, remaining);
    for (const file of toUpload) {
        const placeholder = {
            id: Math.random().toString(36).slice(2, 9),
            name: file.name,
            preview: URL.createObjectURL(file),
            progress: 0,
            uploaded: null,
            error: null,
        };
        state.pendingAttachments.push(placeholder);
        renderAttachments();
        try {
            const user = await requireUser();
            if (!user) { state.pendingAttachments = state.pendingAttachments.filter((a) => a !== placeholder); renderAttachments(); return; }
            const result = await uploadAttachment(file, user.uid, (pct) => {
                placeholder.progress = pct;
                renderAttachments();
            });
            placeholder.uploaded = result;
            placeholder.progress = 100;
            renderAttachments();
        } catch (err) {
            placeholder.error = err.message;
            renderAttachments();
            showToast(err.message || 'Upload failed', { error: true });
            state.pendingAttachments = state.pendingAttachments.filter((a) => a !== placeholder);
            renderAttachments();
        }
    }
    els.fAttachments.value = '';
}

function renderAttachments() {
    if (state.pendingAttachments.length === 0) {
        els.attachList.innerHTML = '';
        return;
    }
    els.attachList.innerHTML = state.pendingAttachments.map((a) => `
        <div class="attach-item" data-aid="${a.id}">
            <img src="${a.preview}" alt="" />
            ${a.uploaded ? '' : `<div class="progress">${a.progress}%</div>`}
            <button class="attach-remove" data-remove="${a.id}" aria-label="Remove">&times;</button>
        </div>
    `).join('');
    els.attachList.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.pendingAttachments = state.pendingAttachments.filter((a) => a.id !== btn.dataset.remove);
            renderAttachments();
        });
    });
}

async function submitIdea() {
    const title = els.fTitle.value.trim();
    const description = els.fDescription.value.trim();
    const category = els.fCategory.value;
    if (!title || !description) {
        els.submitError.textContent = 'Title and description are required.';
        els.submitError.hidden = false;
        return;
    }
    const incomplete = state.pendingAttachments.find((a) => !a.uploaded);
    if (incomplete) {
        els.submitError.textContent = 'Wait for attachments to finish uploading.';
        els.submitError.hidden = false;
        return;
    }
    const attachments = state.pendingAttachments.map((a) => a.uploaded);
    els.submitConfirm.disabled = true;
    els.submitConfirm.textContent = 'Posting...';
    els.submitError.hidden = true;
    try {
        const res = await callables.submit({ title, description, category, attachments });
        closeSubmit();
        showToast('Idea posted.');
        location.href = `/idea.html?id=${encodeURIComponent(res.data.id)}`;
    } catch (err) {
        els.submitError.textContent = err.message || 'Submit failed.';
        els.submitError.hidden = false;
    } finally {
        els.submitConfirm.disabled = false;
        els.submitConfirm.textContent = 'Post idea';
    }
}

(async function init() {
    state.user = await currentUser();
    state.userDocId = state.user ? await getUserDocId(state.user.uid) : null;
    renderUserBadge();
    await load();
})();
