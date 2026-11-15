import { requireUser } from './ideasAuth.js';
import {
    statusBadge, categoryChip, escapeHtml, linkify, relativeTime,
    callable, watchIdeaDoc, watchIdeaComments,
    fetchOwnVotes, avatarHtml, showToast,
    STATUS_LABELS,
} from './ideasShared.js';

// Reusable idea-detail controller. Renders a single idea (description, votes,
// attachments, comments, admin controls) into a host element and keeps it live
// via Firestore watchers. Both the standalone idea.html page and the ideas.html
// right-side panel create one of these.
//
// Options:
//   root          - element to render the detail into
//   lightbox      - element toggled open to zoom an attachment (optional)
//   lightboxImg   - the <img> inside the lightbox (optional)
//   onCardSync    - (ideaId, patch) called whenever a field a list card shows
//                   changes, so the host can update that card in place. patch is
//                   a partial of { voteCount, voted, status, commentCount, title,
//                   category }.
//   onMerged      - (targetId) idea was merged away; host decides where to go.
//   onDeleted     - (ideaId) idea was deleted; host decides where to go.
export function createIdeaDetail({ root, lightbox = null, lightboxImg = null, onCardSync, onMerged, onDeleted } = {}) {
    const state = {
        requestId: null,
        user: null,
        userDocId: null,
        userProfile: null,
        isSysAdmin: false,
        voted: false,
        idea: null,
        comments: [],
    };

    let unsubDoc = null;
    let unsubComments = null;

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

    if (lightbox) {
        lightbox.addEventListener('click', () => {
            lightbox.classList.remove('is-open');
            if (lightboxImg) lightboxImg.src = '';
        });
    }

    function syncCard(patch) {
        if (onCardSync && state.requestId) onCardSync(state.requestId, patch);
    }

    function teardown() {
        if (unsubDoc) { unsubDoc(); unsubDoc = null; }
        if (unsubComments) { unsubComments(); unsubComments = null; }
    }

    // Point the controller at a new idea. Re-subscribes the watchers and shows a
    // skeleton immediately so switching ideas feels instant.
    function open(requestId) {
        teardown();
        state.requestId = requestId;
        state.idea = null;
        state.comments = [];
        state.voted = false;
        renderSkeleton();

        unsubDoc = watchIdeaDoc(requestId, (idea) => {
            state.idea = idea;
            if (idea.mergedIntoId) {
                showMergedRedirect(idea.mergedIntoId);
                if (onMerged) onMerged(idea.mergedIntoId);
                return;
            }
            syncCard({
                voteCount: idea.voteCount ?? 0,
                status: idea.status || 'open',
                commentCount: idea.commentCount ?? 0,
                title: idea.title || 'Untitled',
                category: idea.category || 'other',
            });
            refreshOwnVote().then(render);
        });

        unsubComments = watchIdeaComments(requestId, (comments) => {
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
    }

    function close() {
        teardown();
        state.requestId = null;
        state.idea = null;
        state.comments = [];
    }

    // Update the signed-in user context. The host owns auth; it computes the
    // profile + sysadmin flag and hands it in here.
    function setUser({ user, userDocId, userProfile, isSysAdmin } = {}) {
        state.user = user || null;
        state.userDocId = userDocId || null;
        state.userProfile = userProfile || null;
        state.isSysAdmin = !!isSysAdmin;
        if (state.idea) refreshOwnVote().then(render);
    }

    async function refreshOwnVote() {
        if (!state.user || !state.userDocId || !state.requestId) {
            state.voted = false;
            return;
        }
        const set = await fetchOwnVotes(state.userDocId, [state.requestId]);
        state.voted = set.has(state.requestId);
    }

    function renderSkeleton() {
        root.innerHTML = `<div class="ideas-skeleton" style="margin-top: 1.5rem;">
            <div class="ideas-skeleton-card" style="height: 240px;"></div>
            <div class="ideas-skeleton-card" style="height: 60px;"></div>
            <div class="ideas-skeleton-card" style="height: 60px;"></div>
        </div>`;
    }

    function showMergedRedirect(targetId) {
        root.innerHTML = `<div class="merged-banner">
            <i class="bi bi-arrow-right-circle"></i>
            This idea was merged into another. Opening it now.
        </div>`;
    }

    function render() {
        if (!state.idea) return;
        const idea = state.idea;
        const isAuthor = state.userDocId && idea.authorUserId === state.userDocId;
        const canModerate = state.isSysAdmin;
        const canManage = isAuthor || canModerate;
        const author = idea.authorName || 'Anonymous';

        const sysadminBar = canModerate ? renderSysAdminBar(idea) : '';
        const manageBtns = canManage ? `<div style="display:flex;gap:0.4rem;margin-top:0.8rem;">
            ${isAuthor ? `<button class="btn-sq-ghost btn-sm" data-detail="edit-idea">Edit</button>` : ''}
            <button class="btn-sq-ghost btn-sm" data-detail="delete-idea" style="color:#b91c1c;border-color:#fecaca;">Delete</button>
        </div>` : '';

        root.innerHTML = `
            ${sysadminBar}
            <div class="detail-card">
                <div class="detail-header">
                    <button class="vote-stack detail-vote ${state.voted ? 'is-voted' : ''}" data-detail="vote" aria-label="Upvote">
                        <span class="chev"><i class="bi bi-chevron-up"></i></span>
                        <span class="num">${idea.voteCount ?? 0}</span>
                    </button>
                    <div style="flex:1;min-width:0;">
                        <h1 class="detail-title">${escapeHtml(idea.title || 'Untitled')}</h1>
                        <div class="detail-meta">
                            ${statusBadge(idea.status || 'open')}
                            ${categoryChip(idea.category || 'other')}
                            <span class="idea-author">
                                ${avatarHtml(idea.authorAvatar, author, 22)}
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

        wireHandlers();
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
                <select data-detail="admin-status">${opts}</select>
            </label>
            <button class="btn-sq-ghost btn-sm" data-detail="admin-merge">Merge into…</button>
        </div>`;
    }

    function renderComposer() {
        if (!state.user) {
            return `<div class="comment-composer">
                ${avatarHtml('', '?', 36)}
                <div class="comment-composer-fields">
                    <button class="btn-sq-ghost" data-detail="composer-signin">Sign in to comment</button>
                </div>
            </div>`;
        }
        const photo = state.userProfile?.avatarUrl || state.user.photoURL || '';
        const name = state.userProfile?.name || state.user.displayName || state.user.email || '';
        return `<div class="comment-composer">
                ${avatarHtml(photo, name, 36)}
                <div class="comment-composer-fields">
                    <textarea data-detail="composer-text" maxlength="2000" placeholder="Add a comment..."></textarea>
                    <div class="composer-actions">
                        <button class="btn-sq-primary" data-detail="composer-post">Comment</button>
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
            ${avatarHtml(c.authorAvatar, c.authorName, 36)}
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

    function $(sel) { return root.querySelector(sel); }

    function wireHandlers() {
        const voteBtn = $('[data-detail="vote"]');
        if (voteBtn) voteBtn.addEventListener('click', voteOnDetail);

        if (lightbox && lightboxImg) {
            root.querySelectorAll('[data-zoom]').forEach((img) => {
                img.addEventListener('click', () => {
                    lightboxImg.src = img.dataset.zoom;
                    lightbox.classList.add('is-open');
                });
            });
        }

        const composerPost = $('[data-detail="composer-post"]');
        if (composerPost) composerPost.addEventListener('click', postComment);
        const composerSignIn = $('[data-detail="composer-signin"]');
        if (composerSignIn) composerSignIn.addEventListener('click', () => requireUser());

        root.querySelectorAll('[data-action="edit-comment"]').forEach((btn) =>
            btn.addEventListener('click', () => editComment(btn.dataset.id)));
        root.querySelectorAll('[data-action="delete-comment"]').forEach((btn) =>
            btn.addEventListener('click', () => deleteComment(btn.dataset.id)));
        root.querySelectorAll('[data-action="pin-comment"]').forEach((btn) =>
            btn.addEventListener('click', () => pinComment(btn.dataset.id)));

        const editIdeaBtn = $('[data-detail="edit-idea"]');
        if (editIdeaBtn) editIdeaBtn.addEventListener('click', editIdea);
        const deleteIdeaBtn = $('[data-detail="delete-idea"]');
        if (deleteIdeaBtn) deleteIdeaBtn.addEventListener('click', deleteIdea);

        const statusSel = $('[data-detail="admin-status"]');
        if (statusSel) statusSel.addEventListener('change', adminUpdateStatus);
        const mergeBtn = $('[data-detail="admin-merge"]');
        if (mergeBtn) mergeBtn.addEventListener('click', adminMerge);
    }

    async function voteOnDetail() {
        const user = await requireUser();
        if (!user) return;
        const btn = $('[data-detail="vote"]');
        if (!btn || !state.idea) return;
        const numEl = btn.querySelector('.num');
        const wasVoted = state.voted;
        const prevCount = state.idea.voteCount ?? 0;
        const nextVoted = !wasVoted;
        const nextCount = Math.max(0, prevCount + (nextVoted ? 1 : -1));

        state.voted = nextVoted;
        state.idea.voteCount = nextCount;
        if (numEl) numEl.textContent = nextCount;
        btn.classList.toggle('is-voted', nextVoted);
        syncCard({ voteCount: nextCount, voted: nextVoted });

        try {
            const res = await callables.vote({ requestId: state.requestId });
            state.voted = res.data.voted;
            state.idea.voteCount = res.data.voteCount;
            if (numEl) numEl.textContent = res.data.voteCount;
            btn.classList.toggle('is-voted', res.data.voted);
            syncCard({ voteCount: res.data.voteCount, voted: res.data.voted });
        } catch (err) {
            state.voted = wasVoted;
            state.idea.voteCount = prevCount;
            if (numEl) numEl.textContent = prevCount;
            btn.classList.toggle('is-voted', wasVoted);
            syncCard({ voteCount: prevCount, voted: wasVoted });
            showToast(err.message || 'Could not vote', { error: true });
        }
    }

    async function postComment() {
        const user = await requireUser();
        if (!user) return;
        const ta = $('[data-detail="composer-text"]');
        const body = (ta.value || '').trim();
        if (!body) return;
        const btn = $('[data-detail="composer-post"]');
        btn.disabled = true;
        btn.textContent = 'Posting...';
        try {
            await callables.addComment({ requestId: state.requestId, body });
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
            await callables.editComment({ requestId: state.requestId, commentId, body: trimmed });
            showToast('Updated.');
        } catch (err) {
            showToast(err.message || 'Could not edit', { error: true });
        }
    }

    async function deleteComment(commentId) {
        if (!confirm('Delete this comment?')) return;
        try {
            await callables.deleteComment({ requestId: state.requestId, commentId });
            showToast('Deleted.');
        } catch (err) {
            showToast(err.message || 'Could not delete', { error: true });
        }
    }

    async function pinComment(commentId) {
        const c = state.comments.find((x) => x.id === commentId);
        if (!c) return;
        try {
            await callables.adminPin({ requestId: state.requestId, commentId, pinned: !c.isPinned });
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
                requestId: state.requestId,
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
        const deletedId = state.requestId;
        try {
            await callables.deleteRequest({ requestId: deletedId });
            showToast('Idea deleted.');
            if (onDeleted) onDeleted(deletedId);
        } catch (err) {
            showToast(err.message || 'Could not delete', { error: true });
        }
    }

    async function adminUpdateStatus(e) {
        const status = e.target.value;
        if (!state.idea) return;
        const prevStatus = state.idea.status;
        state.idea.status = status;
        render();
        syncCard({ status });
        try {
            await callables.adminStatus({ requestId: state.requestId, status });
            showToast(`Status set to ${STATUS_LABELS[status]}.`);
        } catch (err) {
            state.idea.status = prevStatus;
            render();
            syncCard({ status: prevStatus });
            showToast(err.message || 'Could not update', { error: true });
        }
    }

    async function adminMerge() {
        const targetId = prompt('Merge this idea INTO which idea? Paste the target idea id (from its URL).');
        if (!targetId) return;
        if (!confirm(`Merge this request into ${targetId}? Votes will move to the target.`)) return;
        try {
            const res = await callables.adminMerge({ sourceId: state.requestId, targetId: targetId.trim() });
            showToast(`Merged. ${res.data.votesMerged} new votes moved.`);
            if (onMerged) onMerged(targetId.trim());
        } catch (err) {
            showToast(err.message || 'Could not merge', { error: true });
        }
    }

    return { open, close, setUser };
}
