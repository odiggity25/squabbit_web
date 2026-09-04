import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, query, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

// Standalone ad editor. Reached from the admin Ads and Pending tabs (and from
// the Slack ad-draft deeplink) as admin-ad.html?id=<adId>&from=<sub-tab>. Editing
// lives on its own page so it opens identically from either tab. On save/cancel it
// returns to admin.html on the sub-tab it came from. New ads use admin-ad.html with
// no id. The form + upload logic mirrors what used to live inline in adminAds.js.
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
const storage = getStorage(app);

const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // Storage rules allow ad videos up to 25MB.

const params = new URLSearchParams(location.search);
const editingAdId = params.get('id') || null;
const fromTab = params.get('from') || 'ads';

let editingImageUrl = null;
let selectedImageFile = null;
let editingVideoUrl = null;
let selectedVideoFile = null;
let removeVideo = false;
let imageMode = 'file';

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

function toLocalDatetimeString(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function returnToAdmin() {
    location.href = `admin.html?tab=ads&sub=${encodeURIComponent(fromTab)}`;
}

function adResult(msg, success) {
    const el = document.getElementById('ad-form-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    el.classList.remove('d-none');
    if (success) setTimeout(() => el.classList.add('d-none'), 4000);
}

function setImageMode(mode) {
    imageMode = mode;
    document.getElementById('ad-image').classList.toggle('d-none', mode !== 'file');
    document.getElementById('ad-image-url').classList.toggle('d-none', mode !== 'url');
    document.getElementById('ad-image-mode-file').classList.toggle('active', mode === 'file');
    document.getElementById('ad-image-mode-url').classList.toggle('active', mode === 'url');
}

function updateVideoStatus() {
    const statusEl = document.getElementById('ad-video-status');
    const removeBtn = document.getElementById('ad-video-remove');
    if (selectedVideoFile) {
        statusEl.textContent = `Selected: ${selectedVideoFile.name} (${(selectedVideoFile.size / 1048576).toFixed(1)} MB)`;
        removeBtn.classList.add('d-none');
    } else if (editingVideoUrl && !removeVideo) {
        statusEl.textContent = 'This ad has a video attached.';
        removeBtn.classList.remove('d-none');
    } else if (removeVideo) {
        statusEl.textContent = 'Video will be removed on save.';
        removeBtn.classList.add('d-none');
    } else {
        statusEl.textContent = '';
        removeBtn.classList.add('d-none');
    }
}

function populateForm(item) {
    editingImageUrl = item?.imageUrl || null;
    editingVideoUrl = item?.videoUrl || null;
    setImageMode('file');
    document.getElementById('ad-form-title').textContent = item ? 'Edit ad' : 'New ad';
    document.getElementById('ad-company').value = item?.companyName || '';
    document.getElementById('ad-title').value = item?.title || '';
    document.getElementById('ad-body').value = item?.body || '';
    document.getElementById('ad-url').value = item?.url || '';
    document.getElementById('ad-priority').value = item?.priority ?? 0;
    document.getElementById('ad-min-version').value = item?.minAppVersion ?? 0;
    document.getElementById('ad-active').checked = item?.active !== false;
    document.getElementById('ad-internal-preview').checked = item?.internalPreview !== false;
    document.getElementById('ad-preview-user-ids').value = (item?.previewUserIds || []).join('\n');

    // Dates are optional and advertiser-owned: empty means "as soon as approved"
    // / "until the budget is spent". Don't invent a default window here.
    document.getElementById('ad-start-date').value = item?.startDate?.toDate
        ? toLocalDatetimeString(item.startDate.toDate())
        : '';
    document.getElementById('ad-end-date').value = item?.endDate?.toDate
        ? toLocalDatetimeString(item.endDate.toDate())
        : '';

    const preview = document.getElementById('ad-image-preview');
    if (item?.imageUrl) {
        preview.src = item.imageUrl;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
    updateVideoStatus();
}

// Admin view of the full activity log for an ad (both advertiser- and admin-audience
// rows). Sorted newest-first client-side; failures degrade quietly.
async function renderAdEvents(id) {
    const section = document.getElementById('ad-events-section');
    const listEl = document.getElementById('ad-events-list');
    if (!id) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    listEl.innerHTML = '<span class="text-muted">Loading…</span>';
    try {
        const snap = await getDocs(query(collection(db, 'ads', id, 'events')));
        const rows = snap.docs.map((d) => d.data())
            .map((e) => ({ ...e, when: e.at?.toDate ? e.at.toDate() : null }))
            .filter((e) => e.when)
            .sort((a, b) => b.when - a.when);
        if (rows.length === 0) { listEl.innerHTML = '<span class="text-muted">No events.</span>'; return; }
        listEl.innerHTML = rows.map((e) => {
            const detail = e.type === 'creativeUpdated' && Array.isArray(e.details?.fields)
                ? ` (${e.details.fields.join(', ')})`
                : (e.type === 'rejected' && e.details?.note ? ` — ${e.details.note}` : '');
            const aud = e.audience === 'admin' ? ' <span class="badge bg-secondary">admin</span>' : '';
            return `<div class="border-bottom py-1"><strong>${escapeHtml(e.type)}</strong>${escapeHtml(detail)}${aud} <span class="text-muted">· ${escapeHtml(e.actor || '')} · ${escapeHtml(e.when.toLocaleString())}</span></div>`;
        }).join('');
    } catch (err) {
        listEl.innerHTML = `<span class="text-danger">Could not load events: ${escapeHtml(err.message)}</span>`;
    }
}

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

async function saveAd() {
    const companyName = document.getElementById('ad-company').value.trim();
    const title = document.getElementById('ad-title').value.trim();
    const body = document.getElementById('ad-body').value.trim();
    const url = document.getElementById('ad-url').value.trim();
    const startDateVal = document.getElementById('ad-start-date').value;
    const endDateVal = document.getElementById('ad-end-date').value;
    const priority = parseInt(document.getElementById('ad-priority').value) || 0;
    const minAppVersion = parseInt(document.getElementById('ad-min-version').value) || 0;
    const active = document.getElementById('ad-active').checked;
    const previewUserIds = [...new Set(
        document.getElementById('ad-preview-user-ids').value
            .split(/[\s,]+/)
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
    )];

    // Dates are optional (empty = as soon as approved / until budget spent).
    if (startDateVal && endDateVal && new Date(endDateVal) < new Date(startDateVal)) {
        adResult('End date must be after the start date.', false);
        return;
    }

    const imageUrlInput = document.getElementById('ad-image-url').value.trim();
    const hasNewImage = selectedImageFile || (imageMode === 'url' && imageUrlInput);
    if (!editingAdId && !hasNewImage) { adResult('Image is required for new ads.', false); return; }

    if (selectedVideoFile && selectedVideoFile.size >= MAX_VIDEO_BYTES) { adResult('Video must be under 25 MB.', false); return; }

    const btn = document.getElementById('save-ad-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const id = editingAdId || crypto.randomUUID();
        let imageUrl = editingImageUrl;

        let imageFile = selectedImageFile;
        if (!imageFile && imageMode === 'url' && imageUrlInput) {
            const resp = await fetch(imageUrlInput);
            if (!resp.ok) throw new Error('Failed to fetch image from URL');
            const fetchedBlob = await resp.blob();
            imageFile = new File([fetchedBlob], 'image.jpg', { type: fetchedBlob.type });
        }

        if (imageFile) {
            // GIFs must keep their original bytes - re-encoding through a canvas
            // flattens them to a single static JPEG frame and loses the animation.
            const isGif = imageFile.type === 'image/gif';
            const blob = isGif ? imageFile : await resizeImage(imageFile);
            const contentType = isGif ? 'image/gif' : 'image/jpeg';
            const newPath = `ads/${id}`;
            const storageRef = ref(storage, newPath);
            await uploadBytes(storageRef, blob, { contentType });
            imageUrl = await getDownloadURL(storageRef);

            if (editingAdId && editingImageUrl) {
                try {
                    const oldPath = decodeURIComponent(new URL(editingImageUrl).pathname.split('/o/')[1].split('?')[0]);
                    // Only delete the old image if it lives at a different path. When the
                    // path matches newPath the uploadBytes above already overwrote it, so
                    // deleting here would wipe the image we just uploaded.
                    if (oldPath !== newPath) {
                        await deleteObject(ref(storage, oldPath));
                    }
                } catch (_) { /* old file may not exist */ }
            }
        }

        let videoUrl = removeVideo ? '' : (editingVideoUrl || '');
        if (selectedVideoFile) {
            const videoRef = ref(storage, `ads/${id}_video`);
            await uploadBytes(videoRef, selectedVideoFile, { contentType: selectedVideoFile.type || 'video/mp4' });
            videoUrl = await getDownloadURL(videoRef);
        } else if (removeVideo && editingVideoUrl) {
            try {
                const oldVideoPath = decodeURIComponent(new URL(editingVideoUrl).pathname.split('/o/')[1].split('?')[0]);
                await deleteObject(ref(storage, oldVideoPath));
            } catch (_) { /* old video may not exist */ }
        }

        const edited = {
            id,
            companyName,
            title,
            body,
            url,
            priority,
            minAppVersion,
            active,
            internalPreview: document.getElementById('ad-internal-preview').checked,
            previewUserIds,
            imageUrl,
            videoUrl,
        };
        // setDoc overwrites the whole doc, so on an edit we START from the existing
        // doc and overlay only what the form changes. That preserves everything the
        // form doesn't touch — budget, targetImpressions, spentCents, targetCountries,
        // hiddenFields, aiModeration, funding/lifecycle timestamps, etc.
        let docData;
        if (editingAdId) {
            const existing = await getDoc(doc(db, 'ads', id));
            const base = existing.exists() ? existing.data() : {};
            docData = { ...base, ...edited };
            if (!base.createdAt) docData.createdAt = serverTimestamp();
        } else {
            docData = { ...edited, impressions: 0, uniqueViews: 0, clicks: 0, dismissals: 0, createdAt: serverTimestamp() };
        }
        // Optional schedule: set the date when entered, else clear it (advertiser "auto").
        if (startDateVal) docData.startDate = Timestamp.fromDate(new Date(startDateVal));
        else delete docData.startDate;
        if (endDateVal) docData.endDate = Timestamp.fromDate(new Date(endDateVal));
        else delete docData.endDate;

        await setDoc(doc(db, 'ads', id), docData);
        returnToAdmin();
    } catch (e) {
        adResult('Error saving: ' + e.message, false);
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

function wireForm() {
    document.getElementById('ad-image').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedImageFile = file;
        const preview = document.getElementById('ad-image-preview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    });
    document.getElementById('ad-image-mode-file').addEventListener('click', () => setImageMode('file'));
    document.getElementById('ad-image-mode-url').addEventListener('click', () => setImageMode('url'));
    document.getElementById('ad-image-url').addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const preview = document.getElementById('ad-image-preview');
        if (val) { preview.src = val; preview.style.display = 'block'; }
        else { preview.style.display = 'none'; }
    });
    document.getElementById('ad-video').addEventListener('change', (e) => {
        const file = e.target.files[0] || null;
        if (file && file.size >= MAX_VIDEO_BYTES) {
            adResult(`Video must be under 25 MB (selected ${(file.size / 1048576).toFixed(1)} MB).`, false);
            e.target.value = '';
            selectedVideoFile = null;
            updateVideoStatus();
            return;
        }
        selectedVideoFile = file;
        removeVideo = false;
        updateVideoStatus();
    });
    document.getElementById('ad-video-remove').addEventListener('click', () => {
        removeVideo = true;
        selectedVideoFile = null;
        document.getElementById('ad-video').value = '';
        updateVideoStatus();
    });
    document.getElementById('save-ad-btn').addEventListener('click', saveAd);
    document.getElementById('cancel-ad-btn').addEventListener('click', returnToAdmin);
    document.getElementById('back-link').addEventListener('click', (e) => { e.preventDefault(); returnToAdmin(); });
}

async function loadEditor() {
    populateForm(null);
    if (editingAdId) {
        try {
            const snap = await getDoc(doc(db, 'ads', editingAdId));
            if (!snap.exists()) { adResult('Ad not found.', false); }
            else populateForm({ id: snap.id, ...snap.data() });
        } catch (e) {
            adResult('Error loading ad: ' + e.message, false);
        }
        await renderAdEvents(editingAdId);
    } else {
        document.getElementById('ad-events-section').style.display = 'none';
    }
}

// --- Auth gate (mirrors admin.js; shares the same sysAdmin cache) ---
const loginSection = document.getElementById('login-section');
const editor = document.getElementById('ad-editor');
const loading = document.getElementById('loading');
const loginError = document.getElementById('login-error');

function showLogin() {
    loading.style.display = 'none';
    loginSection.style.display = 'block';
    editor.style.display = 'none';
}
function showEditor() {
    loading.style.display = 'none';
    loginSection.style.display = 'none';
    editor.style.display = 'block';
    loadEditor();
}
function showLoading() {
    loading.style.display = 'block';
    loginSection.style.display = 'none';
    editor.style.display = 'none';
}

onAuthStateChanged(auth, async (user) => {
    if (!user) { showLogin(); return; }
    const SYSADMIN_TTL_MS = 60 * 60 * 1000;
    const sysAdminCacheKey = 'squabbitSysAdmin:' + user.uid;
    let cachedSysAdminTs = 0;
    try { cachedSysAdminTs = parseInt(localStorage.getItem(sysAdminCacheKey), 10) || 0; } catch (_) {}
    if (cachedSysAdminTs && Date.now() - cachedSysAdminTs < SYSADMIN_TTL_MS) { showEditor(); return; }
    showLoading();
    try {
        const result = await httpsCallable(functions, 'verifySysAdmin')();
        if (result.data.isSysAdmin) {
            try { localStorage.setItem(sysAdminCacheKey, String(Date.now())); } catch (_) {}
            showEditor();
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

wireForm();
