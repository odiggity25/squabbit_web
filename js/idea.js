import { currentUser, requireUser, onUserChange, signOutUser } from './ideasAuth.js';
import {
    statusBadge, categoryChip, escapeHtml, linkify, relativeTime,
    callable, watchIdeaDoc, watchIdeaComments,
    getUserDocId, getCallerIsSysAdmin, fetchOwnVotes,
    STATUS_LABELS,
} from './ideasShared.js';

const params = new URLSearchParams(location.search);
const requestId = params.get('id');

if (!requestId) {
    document.getElementById('detail-root').innerHTML = errorHtml('Missing idea id.');
    throw new Error('missing id');
}

const root = document.getElementById('detail-root');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

const state = {
    user: null,
    userDocId: null,
    isSysAdmin: false,
    voted: false,
    idea: null,
    comments: [],
};

const callables = {
    vote: callable('voteFeatureRequest'),
    addComment: callable('addCommentToRequest'),
    editComment: callable('editComment'),
    deleteComment: callable('deleteComment'),
    deleteRequest: callable('deleteFeatureRequest'),
    adminStatus: callable('adminUpdateRequestStatus'),
    adminMerge: callable('adminMergeRequests'),
    adminPin: callable('adminPinComment'),
    editRequest: callable('editFeatureRequest'),
};

lightbox.addEventListener('click', () => {
    lightbox.classList.remove('is-open');
    lightboxImg.src = '';
});

onUserChange(async (user) => {
    state.user = user;
    state.userDocId = user ? await getUserDocId(user.uid) : null;
    state.isSysAdmin = await getCallerIsSysAdmin(state.userDocId);
    if (state.idea) await refreshOwnVote();
    render();
});

watchIdeaDoc(requestId, (idea) => {
    state.idea = idea;
    if (idea.mergedIntoId) {
        showMergedRedirect(idea.mergedIntoId);
        return;
    }
    refreshOwnVote().then(render);
});

watchIdeaComments(requestId, (comments) => {
    comments.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
    });
    state.comments = comments;
    render();
});

async function refreshOwnVote() {
    if (!state.user || !state.userDocId) {
        state.voted = false;
        return;
    }
    const set = await fetchOwnVotes(state.userDocId, [requestId]);
    state.voted = set.has(requestId);
}

function showMergedRedirect(targetId) {
    root.innerHTML = `<div class="merged-banner">
        <i class="bi bi-arrow-right-circle"></i>
        This idea was merged into another. Redirecting…
    </div>`;
    setTimeout(() => location.replace(`/idea.html?id=${encodeURIComponent(targetId)}`), 1200);
}

function errorHtml(msg) {
    return `<div class="ideas-empty">
        <div class="icon"><i class="bi bi-exclamation-circle"></i></div>
        <h3>Could not load idea</h3>
        <p>${escapeHtml(msg)}</p>
        <a class="btn-sq-ghost" href="/ideas.html">Back to all ideas</a>
    </div>`;
}

function render() {
    if (!state.idea) return;
    const idea = state.idea;
    const isAuthor = state.userDocId && idea.authorUserId === state.userDocId;
    const canModerate = state.isSysAdmin;
    const canManage = isAuthor || canModerate;
    const author = idea.authorName || 'Anonymous';
    const avatar = idea.authorAvatar || '/assets/icon_transparent.png';

    const sysadminBar = canModerate ? renderSysAdminBar(idea) : '';
    const manageBtns = canManage ? `<div style="display:flex;gap:0.4rem;margin-top:0.8rem;">
        ${isAuthor ? `<button class="btn-sq-ghost btn-sm" id="edit-idea-btn">Edit</button>` : ''}
        <button class="btn-sq-ghost btn-sm" id="delete-idea-btn" style="color:#b91c1c;border-color:#fecaca;">Delete</button>
    </div>` : '';

    root.innerHTML = `
        ${sysadminBar}
        <div class="detail-card">
            <div class="detail-header">
                <button class="vote-stack detail-vote ${state.voted ? 'is-voted' : ''}" id="detail-vote" aria-label="Upvote">
                    <span class="chev"><i class="bi bi-chevron-up"></i></span>
                    <span class="num">${idea.voteCount ?? 0}</span>
                </button>
                <div style="flex:1;min-width:0;">
                    <h1 class="detail-title">${escapeHtml(idea.title || 'Untitled')}</h1>
                    <div class="detail-meta">
                        ${statusBadge(idea.status || 'open')}
                        ${categoryChip(idea.category || 'other')}
                        <span class="idea-author">
                            <img src="${escapeHtml(avatar)}" alt="" onerror="this.src='/assets/icon_transparent.png'" style="width:22px;height:22px;border-radius:50%;object-fit:cover;" />
                            ${escapeHtml(author)}
                        </span>
                        <span>${escapeHtml(relativeTime(idea.createdAt))}</span>
                    </div>
                    ${manageBtns}
                </div>
            </div>
            <div class="detail-description">${linkify(idea.description || '')}</div>
            ${renderAttachments(idea.attachments)}
        </div>

        <section class="comments-section">
            <h2 class="comments-heading">${state.comments.length} ${state.comments.length === 1 ? 'comment' : 'comments'}</h2>
            ${renderComposer()}
            <div id="comments-list">${state.comments.map(renderComment).join('') || ''}</div>
        </section>
    `;

    wireDetailHandlers();
}

function renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';
    return `<div class="attach-gallery">
        ${attachments.map((a) => `<img src="${escapeHtml(a.url)}" alt="attachment" data-zoom="${escapeHtml(a.url)}" />`).join('')}
    </div>`;
}

function renderSysAdminBar(idea) {
    const opts = Object.entries(STATUS_LABELS).map(([k, v]) =>
        `<option value="${k}" ${idea.status === k ? 'selected' : ''}>${v}</option>`).join('');
    return `<div class="sysadmin-bar">
        <strong><i class="bi bi-shield-lock"></i> Sysadmin</strong>
        <label style="display:flex;align-items:center;gap:0.4rem;">
            Status:
            <select id="admin-status-select">${opts}</select>
        </label>
        <button class="btn-sq-ghost btn-sm" id="admin-merge-btn">Merge into…</button>
    </div>`;
}

function renderComposer() {
    if (!state.user) {
        return `<div class="comment-composer">
            <img class="avatar" src="/assets/icon_transparent.png" alt="" />
            <div class="comment-composer-fields">
                <button class="btn-sq-ghost" id="composer-signin">Sign in to comment</button>
            </div>
        </div>`;
    }
    const photo = state.user.photoURL || '/assets/icon_transparent.png';
    return `<div class="comment-composer">
            <img class="avatar" src="${escapeHtml(photo)}" alt="" onerror="this.src='/assets/icon_transparent.png'" />
            <div class="comment-composer-fields">
                <textarea id="composer-text" maxlength="2000" placeholder="Add a comment..."></textarea>
                <div class="composer-actions">
                    <button class="btn-sq-primary" id="composer-post">Comment</button>
                </div>
            </div>
        </div>`;
}

function renderComment(c) {
    const isMine = state.userDocId && c.authorUserId === state.userDocId;
    const canManage = isMine || state.isSysAdmin;
    const adminBadge = c.isAdminReply ? '<span class="badge-admin">Squabbit</span>' : '';
    const cls = ['comment'];
    if (c.isAdminReply) cls.push('is-admin');
    if (c.isPinned) cls.push('is-pinned');
    return `<div class="${cls.join(' ')}" data-cid="${escapeHtml(c.id)}">
        <img class="avatar" src="${escapeHtml(c.authorAvatar || '/assets/icon_transparent.png')}" alt="" onerror="this.src='/assets/icon_transparent.png'" />
        <div class="comment-body">
            <div class="comment-head">
                <span class="name">${escapeHtml(c.authorName || 'Anonymous')}</span>
                ${adminBadge}
                <span class="when">${escapeHtml(relativeTime(c.createdAt))}</span>
            </div>
            <div class="comment-text">${linkify(c.body || '')}</div>
            ${canManage || state.isSysAdmin ? `<div class="comment-actions">
                ${isMine ? `<button data-action="edit-comment" data-id="${escapeHtml(c.id)}">Edit</button>` : ''}
                ${canManage ? `<button data-action="delete-comment" data-id="${escapeHtml(c.id)}">Delete</button>` : ''}
                ${state.isSysAdmin ? `<button data-action="pin-comment" data-id="${escapeHtml(c.id)}">${c.isPinned ? 'Unpin' : 'Pin'}</button>` : ''}
            </div>` : ''}
        </div>
    </div>`;
}

function wireDetailHandlers() {
    const voteBtn = document.getElementById('detail-vote');
    if (voteBtn) voteBtn.addEventListener('click', voteOnDetail);

    document.querySelectorAll('[data-zoom]').forEach((img) => {
        img.addEventListener('click', () => {
            lightboxImg.src = img.dataset.zoom;
            lightbox.classList.add('is-open');
        });
    });

    const composerPost = document.getElementById('composer-post');
    if (composerPost) composerPost.addEventListener('click', postComment);
    const composerSignIn = document.getElementById('composer-signin');
    if (composerSignIn) composerSignIn.addEventListener('click', () => requireUser());

    document.querySelectorAll('[data-action="edit-comment"]').forEach((btn) =>
        btn.addEventListener('click', () => editComment(btn.dataset.id)));
    document.querySelectorAll('[data-action="delete-comment"]').forEach((btn) =>
        btn.addEventListener('click', () => deleteComment(btn.dataset.id)));
    document.querySelectorAll('[data-action="pin-comment"]').forEach((btn) =>
        btn.addEventListener('click', () => pinComment(btn.dataset.id)));

    const editIdeaBtn = document.getElementById('edit-idea-btn');
    if (editIdeaBtn) editIdeaBtn.addEventListener('click', editIdea);
    const deleteIdeaBtn = document.getElementById('delete-idea-btn');
    if (deleteIdeaBtn) deleteIdeaBtn.addEventListener('click', deleteIdea);

    const statusSel = document.getElementById('admin-status-select');
    if (statusSel) statusSel.addEventListener('change', adminUpdateStatus);
    const mergeBtn = document.getElementById('admin-merge-btn');
    if (mergeBtn) mergeBtn.addEventListener('click', adminMerge);
}

async function voteOnDetail() {
    const user = await requireUser();
    if (!user) return;
    const btn = document.getElementById('detail-vote');
    btn.classList.add('is-loading');
    try {
        const res = await callables.vote({ requestId });
        state.voted = res.data.voted;
        state.idea.voteCount = res.data.voteCount;
        const numEl = btn.querySelector('.num');
        if (numEl) numEl.textContent = res.data.voteCount;
        btn.classList.toggle('is-voted', res.data.voted);
    } catch (err) {
        showToast(err.message || 'Could not vote', { error: true });
    } finally {
        btn.classList.remove('is-loading');
    }
}

async function postComment() {
    const user = await requireUser();
    if (!user) return;
    const ta = document.getElementById('composer-text');
    const body = (ta.value || '').trim();
    if (!body) return;
    const btn = document.getElementById('composer-post');
    btn.disabled = true;
    btn.textContent = 'Posting...';
    try {
        await callables.addComment({ requestId, body });
        ta.value = '';
        showToast('Comment posted.');
    } catch (err) {
        showToast(err.message || 'Could not post', { error: true });
    } finally {
        btn.disabled = false;
        btn.textContent = 'Comment';
    }
}

async function editComment(commentId) {
    const c = state.comments.find((x) => x.id === commentId);
    if (!c) return;
    const next = prompt('Edit comment:', c.body || '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try {
        await callables.editComment({ requestId, commentId, body: trimmed });
        showToast('Updated.');
    } catch (err) {
        showToast(err.message || 'Could not edit', { error: true });
    }
}

async function deleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;
    try {
        await callables.deleteComment({ requestId, commentId });
        showToast('Deleted.');
    } catch (err) {
        showToast(err.message || 'Could not delete', { error: true });
    }
}

async function pinComment(commentId) {
    const c = state.comments.find((x) => x.id === commentId);
    if (!c) return;
    try {
        await callables.adminPin({ requestId, commentId, pinned: !c.isPinned });
        showToast(c.isPinned ? 'Unpinned.' : 'Pinned.');
    } catch (err) {
        showToast(err.message || 'Could not pin', { error: true });
    }
}

async function editIdea() {
    const idea = state.idea;
    const newTitle = prompt('Title:', idea.title || '');
    if (newTitle == null) return;
    const newDescription = prompt('Description:', idea.description || '');
    if (newDescription == null) return;
    try {
        await callables.editRequest({
            requestId,
            title: newTitle.trim(),
            description: newDescription.trim(),
        });
        showToast('Idea updated.');
    } catch (err) {
        showToast(err.message || 'Could not edit', { error: true });
    }
}

async function deleteIdea() {
    if (!confirm('Delete this idea? This cannot be undone.')) return;
    try {
        await callables.deleteRequest({ requestId });
        showToast('Idea deleted.');
        setTimeout(() => location.replace('/ideas.html'), 600);
    } catch (err) {
        showToast(err.message || 'Could not delete', { error: true });
    }
}

async function adminUpdateStatus(e) {
    const status = e.target.value;
    try {
        await callables.adminStatus({ requestId, status });
        showToast(`Status set to ${STATUS_LABELS[status]}.`);
    } catch (err) {
        showToast(err.message || 'Could not update', { error: true });
    }
}

async function adminMerge() {
    const targetId = prompt('Merge this idea INTO which idea? Paste the target idea id (from its URL).');
    if (!targetId) return;
    if (!confirm(`Merge this request into ${targetId}? Votes will move to the target.`)) return;
    try {
        const res = await callables.adminMerge({ sourceId: requestId, targetId: targetId.trim() });
        showToast(`Merged. ${res.data.votesMerged} new votes moved.`);
        setTimeout(() => location.replace(`/idea.html?id=${encodeURIComponent(targetId.trim())}`), 800);
    } catch (err) {
        showToast(err.message || 'Could not merge', { error: true });
    }
}

function showToast(msg, opts = {}) {
    const el = document.getElementById('ideas-toast');
    el.textContent = msg;
    el.classList.toggle('is-error', !!opts.error);
    el.classList.add('is-shown');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-shown'), 3000);
}

(async function init() {
    state.user = await currentUser();
    state.userDocId = state.user ? await getUserDocId(state.user.uid) : null;
    state.isSysAdmin = await getCallerIsSysAdmin(state.userDocId);
    await refreshOwnVote();
})();
