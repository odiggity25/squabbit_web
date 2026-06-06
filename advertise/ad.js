import {
    auth,
    db,
    storage,
    requireSignedIn,
    signOutUser,
    escapeHtml,
    formatDate,
} from '/advertise/shared.js';
import { renderPreview } from '/advertise/ad-preview.js';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

const MAX_VIDEO_BYTES = 10 * 1024 * 1024;

const state = {
    user: null,
    advertiser: null,
    adId: null,
    adDoc: null, // last loaded server doc, or null for new
    selectedImageFile: null,
    selectedVideoFile: null,
    removeVideo: false,
    viewAsUid: null,
    isAdminPreview: false,
};

const loadingEl = document.getElementById('loading');
const signedOutEl = document.getElementById('signed-out-view');
const notAuthorizedEl = document.getElementById('not-authorized-view');
const editorEl = document.getElementById('editor-view');
const resultEl = document.getElementById('ad-result');

const companyEl = document.getElementById('ad-company');
const titleEl = document.getElementById('ad-title');
const bodyEl = document.getElementById('ad-body');
const urlEl = document.getElementById('ad-url');
const imageEl = document.getElementById('ad-image');
const imagePreviewEl = document.getElementById('ad-image-preview');
const videoEl = document.getElementById('ad-video');
const videoStatusEl = document.getElementById('ad-video-status');
const videoRemoveBtn = document.getElementById('ad-video-remove');
const previewTarget = document.getElementById('ad-preview-card');

function showResult(msg, kind) {
    resultEl.className = `alert alert-${kind}`;
    resultEl.textContent = msg;
    resultEl.classList.remove('d-none');
    setTimeout(() => resultEl.classList.add('d-none'), 4000);
}

function getQueryAdId() {
    return new URLSearchParams(window.location.search).get('id');
}

function getViewAsUid() {
    return new URLSearchParams(window.location.search).get('viewAs');
}

document.getElementById('sign-out-btn').addEventListener('click', () => signOutUser());

requireSignedIn(async (user, advertiser) => {
    loadingEl.style.display = 'none';
    if (!user) {
        signedOutEl.style.display = 'block';
        return;
    }
    state.viewAsUid = getViewAsUid();
    state.adId = getQueryAdId();

    // Admin preview path: load the target advertiser's profile and the ad doc
    // without enforcing ownership. Read access is gated by isMeAdmin() so a
    // non-admin user hitting this URL gets permission-denied on the profile
    // fetch and we fall back to the standard path.
    if (state.viewAsUid && state.adId) {
        try {
            const { getAdvertiser } = await import('/advertise/shared.js');
            const targetAdvertiser = await getAdvertiser(state.viewAsUid);
            if (targetAdvertiser) {
                const snap = await getDoc(doc(db, 'ads', state.adId));
                if (!snap.exists() || snap.data().ownerId !== state.viewAsUid) {
                    notAuthorizedEl.style.display = 'block';
                    return;
                }
                state.user = { uid: state.viewAsUid };
                state.advertiser = targetAdvertiser;
                state.adDoc = snap.data();
                state.isAdminPreview = true;
                editorEl.style.display = 'block';
                renderAdminPreviewChrome(targetAdvertiser);
                populateForm();
                updatePreview();
                lockFormForAdminPreview();
                return;
            }
        } catch (e) {
            console.warn('admin preview lookup failed:', e);
        }
        // Fall through to normal mode if the lookup failed.
    }

    if (!advertiser) {
        window.location.href = '/advertise/portal.html';
        return;
    }
    state.user = user;
    state.advertiser = advertiser;
    if (state.adId) {
        try {
            const snap = await getDoc(doc(db, 'ads', state.adId));
            if (!snap.exists()) {
                notAuthorizedEl.style.display = 'block';
                return;
            }
            const data = snap.data();
            if (data.ownerId !== user.uid) {
                notAuthorizedEl.style.display = 'block';
                return;
            }
            state.adDoc = data;
        } catch (e) {
            showResult(`Could not load ad: ${e.message}`, 'danger');
            return;
        }
    }
    editorEl.style.display = 'block';
    populateForm();
    updatePreview();
});

function renderAdminPreviewChrome(targetAdvertiser) {
    // Swap the editor header back link to point at the admin-preview portal URL,
    // and replace sign-out with "Back to admin".
    const headerLink = document.querySelector('.editor-header a.text-muted');
    if (headerLink) {
        headerLink.textContent = '← Back to portal preview';
        headerLink.setAttribute('href', `/advertise/portal.html?viewAs=${encodeURIComponent(state.viewAsUid)}`);
    }
    // Clone-replace the sign-out button so the existing signOutUser listener
    // doesn't also fire — that would sign the admin out of Firebase before the
    // navigation completes, dumping them on the login screen when they return.
    const oldBtn = document.getElementById('sign-out-btn');
    if (oldBtn) {
        const newBtn = oldBtn.cloneNode(true);
        newBtn.textContent = '← Back to admin';
        oldBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });
    }
    // Banner.
    const editor = document.getElementById('editor-view');
    const banner = document.createElement('div');
    banner.className = 'admin-preview-banner';
    banner.innerHTML = `<strong>Admin preview</strong> &middot; Inspecting ${escapeHtml(targetAdvertiser.brandName)}'s ad. Form is read-only.`;
    editor.insertBefore(banner, editor.firstChild);
}

function lockFormForAdminPreview() {
    const inputs = document.querySelectorAll('#editor-view input, #editor-view textarea, #editor-view select');
    inputs.forEach((el) => { el.disabled = true; });
    const hide = ['save-draft-btn', 'submit-btn', 'delete-btn', 'ad-video-remove'];
    hide.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // Drop the dashed form-text helper lines since they're meaningless in preview.
    document.querySelectorAll('#editor-view .form-text').forEach((el) => { el.style.display = 'none'; });
}

function populateForm() {
    if (state.adDoc) {
        document.getElementById('editor-title').textContent = 'Edit ad';
        companyEl.value = state.adDoc.companyName || '';
        titleEl.value = state.adDoc.title || '';
        bodyEl.value = state.adDoc.body || '';
        urlEl.value = state.adDoc.url || '';
        if (state.adDoc.imageUrl) {
            imagePreviewEl.src = state.adDoc.imageUrl;
            imagePreviewEl.style.display = 'block';
        }
        updateVideoStatus();
    } else {
        document.getElementById('editor-title').textContent = 'New ad';
    }
    updateStatusBanner();
    updateButtonVisibility();
    updateStatsPanel();
}

function status() {
    return state.adDoc?.status || 'draft';
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    const s = status();
    let cls = 'status-draft';
    let text = 'Draft — save changes, then submit when ready.';
    if (!state.adDoc) {
        banner.style.display = 'none';
        return;
    }
    if (s === 'pending') {
        cls = 'status-pending';
        const when = formatDate(state.adDoc.submittedAt);
        text = `Pending review${when ? ` — submitted ${when}` : ''}. You can edit and resave; it stays pending until reviewed.`;
    } else if (s === 'approved') {
        cls = 'status-approved';
        const start = formatDate(state.adDoc.startDate);
        const end = formatDate(state.adDoc.endDate);
        text = `Approved — live${start && end ? ` from ${start} to ${end}` : ''}. Edits save in place and stay live.`;
    } else if (s === 'rejected') {
        cls = 'status-rejected';
        const note = state.adDoc.reviewNote ? ` Reviewer note: ${state.adDoc.reviewNote}` : '';
        text = `Needs changes.${note} Edit and resubmit.`;
    }
    banner.className = `status-banner ${cls}`;
    banner.textContent = text;
    banner.style.display = 'block';
}

function updateButtonVisibility() {
    const submitBtn = document.getElementById('submit-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const saveBtn = document.getElementById('save-draft-btn');
    const s = state.adDoc ? status() : 'new';
    if (s === 'new' || s === 'draft' || s === 'rejected') {
        submitBtn.style.display = '';
        submitBtn.textContent = s === 'rejected' ? 'Resubmit for review' : 'Submit for review';
    } else {
        submitBtn.style.display = 'none';
    }
    if (s === 'draft' || s === 'rejected') {
        deleteBtn.style.display = '';
    } else {
        deleteBtn.style.display = 'none';
    }
    if (s === 'approved') {
        saveBtn.textContent = 'Save changes';
    } else if (s === 'pending') {
        saveBtn.textContent = 'Save changes';
    } else {
        saveBtn.textContent = 'Save draft';
    }
}

function updateStatsPanel() {
    const panel = document.getElementById('stats-panel');
    if (state.adDoc && state.adDoc.status === 'approved') {
        panel.style.display = 'block';
        const impressions = state.adDoc.impressions ?? 0;
        const uniqueViews = state.adDoc.uniqueViews ?? 0;
        const clicks = state.adDoc.clicks ?? 0;
        const dismissals = state.adDoc.dismissals ?? 0;
        document.getElementById('stat-impressions').textContent = impressions.toLocaleString();
        document.getElementById('stat-unique').textContent = uniqueViews.toLocaleString();
        document.getElementById('stat-clicks').textContent = clicks.toLocaleString();
        document.getElementById('stat-dismissals').textContent = dismissals.toLocaleString();
        document.getElementById('stat-ctr').textContent = impressions > 0
            ? `${((clicks / impressions) * 100).toFixed(1)}%`
            : '—';
    } else {
        panel.style.display = 'none';
    }
}

document.getElementById('refresh-stats-btn').addEventListener('click', async () => {
    if (!state.adId) return;
    const snap = await getDoc(doc(db, 'ads', state.adId));
    if (snap.exists()) {
        state.adDoc = snap.data();
        updateStatsPanel();
    }
});

async function submitForReview() {
    if (!state.adId || !state.adDoc) {
        showResult('Save draft first.', 'danger');
        return;
    }
    const s = status();
    if (s !== 'draft' && s !== 'rejected') {
        showResult('Only drafts and rejected ads can be submitted.', 'danger');
        return;
    }
    if (!titleEl.value.trim() || !bodyEl.value.trim() || !urlEl.value.trim() || !state.adDoc.imageUrl) {
        showResult('Headline, body, URL, and image are all required to submit.', 'danger');
        return;
    }
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    try {
        // Save current creative first (some users hit Submit before Save).
        await updateDoc(doc(db, 'ads', state.adId), {
            companyName: companyEl.value.trim(),
            title: titleEl.value.trim(),
            body: bodyEl.value.trim(),
            url: urlEl.value.trim(),
            status: 'pending',
            submittedAt: serverTimestamp(),
            lastUpdatedAt: serverTimestamp(),
        });
        showResult('Submitted for review. We will email you when it is reviewed.', 'success');
        setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 1000);
    } catch (e) {
        showResult(`Could not submit: ${e.message}`, 'danger');
        btn.disabled = false;
        btn.textContent = 'Submit for review';
    }
}

async function deleteAd() {
    if (!state.adId || !state.adDoc) return;
    const s = status();
    if (s !== 'draft' && s !== 'rejected') {
        showResult('Only drafts and rejected ads can be deleted.', 'danger');
        return;
    }
    if (!confirm('Delete this ad? This cannot be undone.')) return;
    try {
        if (state.adDoc.imageUrl) {
            try {
                const oldPath = decodeURIComponent(new URL(state.adDoc.imageUrl).pathname.split('/o/')[1].split('?')[0]);
                await deleteObject(ref(storage, oldPath));
            } catch (_) { /* may not exist */ }
        }
        if (state.adDoc.videoUrl) {
            try {
                const oldPath = decodeURIComponent(new URL(state.adDoc.videoUrl).pathname.split('/o/')[1].split('?')[0]);
                await deleteObject(ref(storage, oldPath));
            } catch (_) { /* may not exist */ }
        }
        await deleteDoc(doc(db, 'ads', state.adId));
        window.location.href = '/advertise/portal.html';
    } catch (e) {
        showResult(`Could not delete: ${e.message}`, 'danger');
    }
}

document.getElementById('submit-btn').addEventListener('click', submitForReview);
document.getElementById('delete-btn').addEventListener('click', deleteAd);

function updateVideoStatus() {
    if (state.selectedVideoFile) {
        videoStatusEl.textContent = `Selected: ${state.selectedVideoFile.name} (${(state.selectedVideoFile.size / 1048576).toFixed(1)} MB)`;
        videoRemoveBtn.classList.add('d-none');
    } else if (state.adDoc?.videoUrl && !state.removeVideo) {
        videoStatusEl.textContent = 'This ad has a video attached.';
        videoRemoveBtn.classList.remove('d-none');
    } else if (state.removeVideo) {
        videoStatusEl.textContent = 'Video will be removed on save.';
        videoRemoveBtn.classList.add('d-none');
    } else {
        videoStatusEl.textContent = '';
        videoRemoveBtn.classList.add('d-none');
    }
}

function updatePreview() {
    renderPreview(previewTarget, {
        companyName: companyEl.value || state.advertiser?.brandName || '',
        title: titleEl.value,
        body: bodyEl.value,
        url: urlEl.value,
        imageUrl: state.selectedImageFile ? URL.createObjectURL(state.selectedImageFile) : (state.adDoc?.imageUrl || ''),
        videoUrl: state.selectedVideoFile ? URL.createObjectURL(state.selectedVideoFile) : (state.removeVideo ? '' : (state.adDoc?.videoUrl || '')),
    });
}

companyEl.addEventListener('input', updatePreview);
titleEl.addEventListener('input', updatePreview);
bodyEl.addEventListener('input', updatePreview);
urlEl.addEventListener('input', updatePreview);

imageEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.selectedImageFile = file;
    imagePreviewEl.src = URL.createObjectURL(file);
    imagePreviewEl.style.display = 'block';
    updatePreview();
});

videoEl.addEventListener('change', (e) => {
    const file = e.target.files[0] || null;
    if (file && file.size >= MAX_VIDEO_BYTES) {
        showResult(`Video must be under 10 MB (selected ${(file.size / 1048576).toFixed(1)} MB).`, 'danger');
        e.target.value = '';
        state.selectedVideoFile = null;
        updateVideoStatus();
        return;
    }
    state.selectedVideoFile = file;
    state.removeVideo = false;
    updateVideoStatus();
    updatePreview();
});

videoRemoveBtn.addEventListener('click', () => {
    state.removeVideo = true;
    state.selectedVideoFile = null;
    videoEl.value = '';
    updateVideoStatus();
    updatePreview();
});

async function resizeImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const maxWidth = 1500;
            let { width, height } = img;
            if (width > maxWidth) {
                height = Math.round(height * maxWidth / width);
                width = maxWidth;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(resolve, 'image/jpeg', 0.6);
        };
        img.src = URL.createObjectURL(file);
    });
}

async function uploadImageIfChanged(id) {
    if (!state.selectedImageFile) return state.adDoc?.imageUrl || '';
    const isGif = state.selectedImageFile.type === 'image/gif';
    const blob = isGif ? state.selectedImageFile : await resizeImage(state.selectedImageFile);
    const contentType = isGif ? 'image/gif' : 'image/jpeg';
    const path = `ads/${id}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob, { contentType });
    return await getDownloadURL(storageRef);
}

async function uploadVideoIfChanged(id) {
    if (state.selectedVideoFile) {
        const videoRef = ref(storage, `ads/${id}_video`);
        await uploadBytes(videoRef, state.selectedVideoFile, { contentType: state.selectedVideoFile.type || 'video/mp4' });
        return await getDownloadURL(videoRef);
    }
    if (state.removeVideo && state.adDoc?.videoUrl) {
        try {
            const oldPath = decodeURIComponent(new URL(state.adDoc.videoUrl).pathname.split('/o/')[1].split('?')[0]);
            await deleteObject(ref(storage, oldPath));
        } catch (_) { /* may not exist */ }
        return '';
    }
    return state.adDoc?.videoUrl || '';
}

async function saveDraft() {
    const companyName = companyEl.value.trim();
    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();
    const url = urlEl.value.trim();
    if (!state.adId && !state.selectedImageFile) {
        showResult('Image is required for new ads.', 'danger');
        return;
    }
    const btn = document.getElementById('save-draft-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        const id = state.adId || crypto.randomUUID();
        const imageUrl = await uploadImageIfChanged(id);
        const videoUrl = await uploadVideoIfChanged(id);

        if (!state.adId) {
            // New draft: write the full doc skeleton matching the Firestore create rule.
            await setDoc(doc(db, 'ads', id), {
                id,
                ownerId: state.user.uid,
                status: 'draft',
                active: false,
                companyName,
                title,
                body,
                url,
                imageUrl,
                videoUrl,
                impressions: 0,
                uniqueViews: 0,
                clicks: 0,
                dismissals: 0,
                priority: 0,
                createdAt: serverTimestamp(),
                lastUpdatedAt: serverTimestamp(),
            });
            state.adId = id;
            // Mirror the new doc into local state so subsequent saves take the update path.
            window.history.replaceState(null, '', `/advertise/ad.html?id=${encodeURIComponent(id)}`);
            const snap = await getDoc(doc(db, 'ads', id));
            state.adDoc = snap.data();
        } else {
            // Update path: rules allow only creative + lastUpdatedAt to change.
            await updateDoc(doc(db, 'ads', state.adId), {
                companyName,
                title,
                body,
                url,
                imageUrl,
                videoUrl,
                lastUpdatedAt: serverTimestamp(),
            });
            const snap = await getDoc(doc(db, 'ads', state.adId));
            state.adDoc = snap.data();
        }
        // Clear pending file selections; they've been uploaded.
        state.selectedImageFile = null;
        state.selectedVideoFile = null;
        state.removeVideo = false;
        imageEl.value = '';
        videoEl.value = '';
        updateVideoStatus();
        updatePreview();
        updateStatusBanner();
        updateButtonVisibility();
        updateStatsPanel();
        showResult('Saved.', 'success');
    } catch (e) {
        showResult(`Error saving: ${e.message}`, 'danger');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save draft';
    }
}

document.getElementById('save-draft-btn').addEventListener('click', saveDraft);
