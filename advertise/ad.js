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
};

const loadingEl = document.getElementById('loading');
const signedOutEl = document.getElementById('signed-out-view');
const notAuthorizedEl = document.getElementById('not-authorized-view');
const editorEl = document.getElementById('editor-view');
const resultEl = document.getElementById('ad-result');

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

document.getElementById('sign-out-btn').addEventListener('click', () => signOutUser());

requireSignedIn(async (user, advertiser) => {
    loadingEl.style.display = 'none';
    if (!user) {
        signedOutEl.style.display = 'block';
        return;
    }
    if (!advertiser) {
        // Bounce to portal to complete profile setup first.
        window.location.href = '/advertise/portal.html';
        return;
    }
    state.user = user;
    state.advertiser = advertiser;
    state.adId = getQueryAdId();
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

function populateForm() {
    if (state.adDoc) {
        document.getElementById('editor-title').textContent = 'Edit ad';
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
    // Buttons: full state will be wired in Task 6 (Submit, Delete, banner).
    // For Task 5 we only need the editor + save draft to work.
    document.getElementById('submit-btn').style.display = 'none';
    document.getElementById('delete-btn').style.display = 'none';
}

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
        title: titleEl.value,
        body: bodyEl.value,
        url: urlEl.value,
        imageUrl: state.selectedImageFile ? URL.createObjectURL(state.selectedImageFile) : (state.adDoc?.imageUrl || ''),
        videoUrl: state.selectedVideoFile ? URL.createObjectURL(state.selectedVideoFile) : (state.removeVideo ? '' : (state.adDoc?.videoUrl || '')),
        brandName: state.advertiser?.brandName,
    });
}

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
        showResult('Saved.', 'success');
    } catch (e) {
        showResult(`Error saving: ${e.message}`, 'danger');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save draft';
    }
}

document.getElementById('save-draft-btn').addEventListener('click', saveDraft);
