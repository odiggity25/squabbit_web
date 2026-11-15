import { currentUser, onUserChange } from './ideasAuth.js';
import { getUserProfile, getCallerIsSysAdmin, escapeHtml } from './ideasShared.js';
import { createIdeaDetail } from './ideaDetail.js';

const params = new URLSearchParams(location.search);
const requestId = params.get('id');

const root = document.getElementById('detail-root');

if (!requestId) {
    root.innerHTML = `<div class="ideas-empty">
        <div class="icon"><i class="bi bi-exclamation-circle"></i></div>
        <h3>Could not load idea</h3>
        <p>${escapeHtml('Missing idea id.')}</p>
        <a class="btn-sq-ghost" href="/ideas.html">Back to all ideas</a>
    </div>`;
    throw new Error('missing id');
}

const detail = createIdeaDetail({
    root,
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightbox-img'),
    onMerged: (targetId) => {
        setTimeout(() => location.replace(`/idea.html?id=${encodeURIComponent(targetId)}`), 800);
    },
    onDeleted: () => {
        setTimeout(() => location.replace('/ideas.html'), 600);
    },
});

async function buildUserContext(user) {
    const profile = user ? await getUserProfile(user.uid) : null;
    const userDocId = profile?.userDocId || null;
    const isSysAdmin = await getCallerIsSysAdmin(userDocId);
    return { user, userDocId, userProfile: profile, isSysAdmin };
}

onUserChange(async (user) => {
    detail.setUser(await buildUserContext(user));
});

(async function init() {
    const user = await currentUser();
    detail.setUser(await buildUserContext(user));
    detail.open(requestId);
})();
