import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, query, where, orderBy, limit, startAfter, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

let db, storage;
let auth;
let editingAdId = null;
const advertiserCache = new Map();
let editingImageUrl = null;
let selectedImageFile = null;
let editingVideoUrl = null;
let selectedVideoFile = null;
let removeVideo = false;
let imageMode = 'file';
const PAGE_SIZE = 5;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024; // Storage rules reject writes >= 10MB.
let pageCursors = [null];
let currentPage = 0;
let lastPageSnapshot = null;

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function toLocalDatetimeString(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function adResult(msg, success) {
    const formOpen = document.getElementById('ad-form-section').style.display !== 'none';
    const el = document.getElementById(formOpen ? 'ad-form-result' : 'ad-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    setTimeout(() => el.classList.add('d-none'), 4000);
}

function pendingResult(msg, success) {
    const el = document.getElementById('pending-ads-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    setTimeout(() => el.classList.add('d-none'), 4000);
}

async function getAdvertiser(ownerId) {
    if (!ownerId) return null;
    if (advertiserCache.has(ownerId)) return advertiserCache.get(ownerId);
    try {
        const snap = await getDoc(doc(db, 'advertisers', ownerId));
        const data = snap.exists() ? snap.data() : null;
        advertiserCache.set(ownerId, data);
        return data;
    } catch (_) {
        return null;
    }
}

export async function loadAds() {
    const listEl = document.getElementById('ad-list');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        const cursor = pageCursors[currentPage];
        const constraints = [collection(db, 'ads'), orderBy('priority', 'desc'), orderBy('startDate', 'desc'), limit(PAGE_SIZE)];
        if (cursor) constraints.push(startAfter(cursor));
        const snap = await getDocs(query(...constraints));
        lastPageSnapshot = snap;
        if (snap.empty && currentPage === 0) {
            listEl.innerHTML = '<p class="text-muted small">No ads yet.</p>';
            renderPagination();
            return;
        }
        listEl.innerHTML = '';
        for (const d of snap.docs) {
            const data = d.data();
            const start = data.startDate?.toDate ? data.startDate.toDate().toLocaleDateString() : '';
            const end = data.endDate?.toDate ? data.endDate.toDate().toLocaleDateString() : '';
            const badges = [];
            if (data.internalPreview === true) badges.push('<span class="badge bg-warning text-dark">Internal Preview</span>');
            if (Array.isArray(data.previewUserIds) && data.previewUserIds.length > 0) badges.push(`<span class="badge bg-info text-dark">${data.previewUserIds.length} preview user${data.previewUserIds.length === 1 ? '' : 's'}</span>`);
            if (data.status === 'pending') badges.push('<span class="badge bg-warning text-dark">Pending review</span>');
            if (data.status === 'rejected') badges.push('<span class="badge bg-danger">Rejected</span>');
            if (data.status === 'draft' && data.ownerId) badges.push('<span class="badge bg-secondary">Advertiser draft</span>');
            if (data.active === false) badges.push('<span class="badge bg-secondary">Inactive</span>');
            else {
                const now = new Date();
                const startDate = data.startDate?.toDate ? data.startDate.toDate() : null;
                const endDate = data.endDate?.toDate ? data.endDate.toDate() : null;
                if (startDate && endDate && now >= startDate && now <= endDate) {
                    badges.push('<span class="badge bg-success">Live</span>');
                } else if (startDate && now < startDate) {
                    badges.push('<span class="badge bg-info text-dark">Scheduled</span>');
                } else if (endDate && now > endDate) {
                    badges.push('<span class="badge bg-secondary">Expired</span>');
                }
            }
            const advertiser = data.ownerId ? await getAdvertiser(data.ownerId) : null;
            const advertiserLine = advertiser
                ? `<div class="small text-muted">Advertiser: ${escapeHtml(advertiser.brandName || data.ownerId)}</div>`
                : '';
            const div = document.createElement('div');
            div.className = 'ad-item';
            div.innerHTML = `
                <img src="${data.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
                <div class="ad-item-info">
                    <h6>${escapeHtml(data.title || '')} ${badges.join(' ')}</h6>
                    ${advertiserLine}
                    <small>${start} – ${end} · P${data.priority ?? 0} · ${data.impressions ?? 0} views (${data.uniqueViews ?? 0} unique) · ${data.clicks ?? 0} clicks · ${data.dismissals ?? 0} not interested</small>
                </div>
                <div class="ad-item-actions">
                    <button class="btn btn-outline-primary btn-sm ad-edit" data-id="${d.id}">Edit</button>
                    <button class="btn btn-outline-danger btn-sm ad-delete" data-id="${d.id}">Delete</button>
                </div>`;
            listEl.appendChild(div);
        }
        listEl.querySelectorAll('.ad-edit').forEach(btn =>
            btn.addEventListener('click', () => editAd(btn.dataset.id)));
        listEl.querySelectorAll('.ad-delete').forEach(btn =>
            btn.addEventListener('click', () => deleteAd(btn.dataset.id)));
        if (snap.docs.length === PAGE_SIZE && !pageCursors[currentPage + 1]) {
            pageCursors[currentPage + 1] = snap.docs[snap.docs.length - 1];
        }
        renderPagination();
    } catch (e) {
        listEl.innerHTML = '<p class="text-danger small">Error loading ads: ' + escapeHtml(e.message) + '</p>';
    }
}

function resetPagination() {
    pageCursors = [null];
    currentPage = 0;
    lastPageSnapshot = null;
}

function renderPagination() {
    let paginationEl = document.getElementById('ad-pagination');
    if (!paginationEl) {
        paginationEl = document.createElement('div');
        paginationEl.id = 'ad-pagination';
        paginationEl.className = 'd-flex justify-content-between mt-2';
        document.getElementById('ad-list').after(paginationEl);
    }
    const hasPrev = currentPage > 0;
    const hasNext = lastPageSnapshot && lastPageSnapshot.docs.length === PAGE_SIZE;
    if (!hasPrev && !hasNext) {
        paginationEl.innerHTML = '';
        return;
    }
    paginationEl.innerHTML = `
        <button class="btn btn-outline-secondary btn-sm ${hasPrev ? '' : 'invisible'}" id="ad-prev">&#8592; Previous</button>
        <button class="btn btn-outline-secondary btn-sm ${hasNext ? '' : 'invisible'}" id="ad-next">Next &#8594;</button>`;
    if (hasPrev) {
        paginationEl.querySelector('#ad-prev').addEventListener('click', () => {
            currentPage--;
            loadAds();
        });
    }
    if (hasNext) {
        paginationEl.querySelector('#ad-next').addEventListener('click', () => {
            currentPage++;
            loadAds();
        });
    }
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

function openAdForm(item = null) {
    editingAdId = item?.id || null;
    editingImageUrl = item?.imageUrl || null;
    selectedImageFile = null;
    editingVideoUrl = item?.videoUrl || null;
    selectedVideoFile = null;
    removeVideo = false;
    setImageMode('file');
    document.getElementById('ad-form-title').textContent = item ? 'Edit Ad' : 'New Ad';
    document.getElementById('ad-company').value = item?.companyName || '';
    document.getElementById('ad-title').value = item?.title || '';
    document.getElementById('ad-body').value = item?.body || '';
    document.getElementById('ad-url').value = item?.url || '';
    document.getElementById('ad-priority').value = item?.priority ?? 0;
    document.getElementById('ad-min-version').value = item?.minAppVersion ?? 0;
    document.getElementById('ad-active').checked = item?.active !== false;
    document.getElementById('ad-internal-preview').checked = item?.internalPreview !== false;
    document.getElementById('ad-preview-user-ids').value = (item?.previewUserIds || []).join('\n');

    const now = new Date();
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    document.getElementById('ad-start-date').value = item?.startDate?.toDate
        ? toLocalDatetimeString(item.startDate.toDate())
        : toLocalDatetimeString(now);
    document.getElementById('ad-end-date').value = item?.endDate?.toDate
        ? toLocalDatetimeString(item.endDate.toDate())
        : toLocalDatetimeString(defaultEnd);

    document.getElementById('ad-image').value = '';
    document.getElementById('ad-image-url').value = '';
    document.getElementById('ad-video').value = '';
    updateVideoStatus();
    const preview = document.getElementById('ad-image-preview');
    if (item?.imageUrl) {
        preview.src = item.imageUrl;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
    document.getElementById('ad-list-section').style.display = 'none';
    document.getElementById('ad-form-section').style.display = 'block';
    renderAdEvents(item?.id || null);
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

function closeAdForm() {
    document.getElementById('ad-form-section').style.display = 'none';
    document.getElementById('ad-list-section').style.display = 'block';
    editingAdId = null;
    editingImageUrl = null;
    selectedImageFile = null;
    editingVideoUrl = null;
    selectedVideoFile = null;
    removeVideo = false;
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

    if (!startDateVal || !endDateVal) { adResult('Start and end dates are required.', false); return; }

    const imageUrlInput = document.getElementById('ad-image-url').value.trim();
    const hasNewImage = selectedImageFile || (imageMode === 'url' && imageUrlInput);
    if (!editingAdId && !hasNewImage) { adResult('Image is required for new ads.', false); return; }

    if (selectedVideoFile && selectedVideoFile.size >= MAX_VIDEO_BYTES) { adResult('Video must be under 10 MB.', false); return; }

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

        const docData = {
            id,
            companyName,
            title,
            body,
            url,
            startDate: Timestamp.fromDate(new Date(startDateVal)),
            endDate: Timestamp.fromDate(new Date(endDateVal)),
            priority,
            minAppVersion,
            active,
            internalPreview: document.getElementById('ad-internal-preview').checked,
            previewUserIds,
            imageUrl,
            videoUrl,
        };

        // Preserve analytics counters AND advertiser-portal fields on edit.
        // setDoc overwrites the whole doc, so any field not carried over is wiped.
        if (editingAdId) {
            const existing = await getDoc(doc(db, 'ads', id));
            if (existing.exists()) {
                const d = existing.data();
                docData.impressions = d.impressions ?? 0;
                docData.uniqueViews = d.uniqueViews ?? 0;
                docData.clicks = d.clicks ?? 0;
                docData.dismissals = d.dismissals ?? 0;
                if (d.ownerId !== undefined) docData.ownerId = d.ownerId;
                if (d.status !== undefined) docData.status = d.status;
                if (d.reviewNote !== undefined) docData.reviewNote = d.reviewNote;
                if (d.submittedAt !== undefined) docData.submittedAt = d.submittedAt;
                if (d.reviewedAt !== undefined) docData.reviewedAt = d.reviewedAt;
                if (d.reviewedBy !== undefined) docData.reviewedBy = d.reviewedBy;
                if (d.createdAt !== undefined) docData.createdAt = d.createdAt;
            }
        } else {
            docData.impressions = 0;
            docData.uniqueViews = 0;
            docData.clicks = 0;
            docData.dismissals = 0;
        }

        await setDoc(doc(db, 'ads', id), docData);

        adResult(editingAdId ? 'Ad updated.' : 'Ad created.', true);
        closeAdForm();
        resetPagination();
        await Promise.all([loadAds(), loadPendingAds()]);
    } catch (e) {
        adResult('Error saving: ' + e.message, false);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

async function editAd(id) {
    try {
        const docSnap = await getDoc(doc(db, 'ads', id));
        if (!docSnap.exists()) { adResult('Ad not found.', false); return; }
        openAdForm({ id: docSnap.id, ...docSnap.data() });
    } catch (e) {
        adResult('Error loading ad: ' + e.message, false);
    }
}

async function deleteAd(id) {
    if (!confirm('Delete this ad? This cannot be undone.')) return;
    try {
        const docRef = doc(db, 'ads', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.imageUrl) {
                try {
                    const path = decodeURIComponent(new URL(data.imageUrl).pathname.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, path));
                } catch (_) { /* image may already be gone */ }
            }
            if (data.videoUrl) {
                try {
                    const videoPath = decodeURIComponent(new URL(data.videoUrl).pathname.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, videoPath));
                } catch (_) { /* video may already be gone */ }
            }
        }
        await deleteDoc(doc(db, 'ads', id));
        adResult('Ad deleted.', true);
        closeAdForm();
        resetPagination();
        await Promise.all([loadAds(), loadPendingAds()]);
    } catch (e) {
        adResult('Error deleting: ' + e.message, false);
    }
}

let pendingAdsCache = [];
let approveTargetId = null;
let rejectTargetId = null;

export async function loadPendingAds() {
    const listEl = document.getElementById('pending-ads-list');
    const countEl = document.getElementById('pending-ads-count');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        const snap = await getDocs(query(
            collection(db, 'ads'),
            where('status', '==', 'pending'),
            orderBy('submittedAt', 'asc')
        ));
        pendingAdsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        countEl.textContent = pendingAdsCache.length > 0 ? String(pendingAdsCache.length) : '';
        if (pendingAdsCache.length === 0) {
            listEl.innerHTML = '<p class="text-muted small">No pending submissions.</p>';
            return;
        }
        listEl.innerHTML = '';
        for (const ad of pendingAdsCache) {
            const advertiser = ad.ownerId ? await getAdvertiser(ad.ownerId) : null;
            const brand = advertiser?.brandName || ad.ownerId || 'Unknown advertiser';
            const submitted = ad.submittedAt?.toDate ? ad.submittedAt.toDate().toLocaleString() : '';
            const div = document.createElement('div');
            div.className = 'ad-item';
            div.innerHTML = `
                <img src="${ad.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
                <div class="ad-item-info">
                    <h6>${escapeHtml(ad.title || '(no title)')}</h6>
                    <div class="small"><strong>${escapeHtml(brand)}</strong>${advertiser?.website ? ' · <a href="' + escapeHtml(advertiser.website) + '" target="_blank" rel="noopener">' + escapeHtml(advertiser.website) + '</a>' : ''}</div>
                    <div class="small text-muted">${escapeHtml(ad.body || '')}</div>
                    <div class="small text-muted">URL: ${escapeHtml(ad.url || '')}</div>
                    <div class="small text-muted">Submitted ${escapeHtml(submitted)}</div>
                </div>
                <div class="ad-item-actions">
                    <button class="btn btn-outline-primary btn-sm pending-edit" data-id="${ad.id}">Edit</button>
                    <button class="btn btn-success btn-sm pending-approve" data-id="${ad.id}">Approve</button>
                    <button class="btn btn-outline-danger btn-sm pending-reject" data-id="${ad.id}">Reject</button>
                </div>`;
            listEl.appendChild(div);
        }
        listEl.querySelectorAll('.pending-edit').forEach((btn) =>
            btn.addEventListener('click', () => editAd(btn.dataset.id)));
        listEl.querySelectorAll('.pending-approve').forEach((btn) =>
            btn.addEventListener('click', () => openApproveModal(btn.dataset.id)));
        listEl.querySelectorAll('.pending-reject').forEach((btn) =>
            btn.addEventListener('click', () => openRejectModal(btn.dataset.id)));
    } catch (e) {
        listEl.innerHTML = `<p class="text-danger small">Error loading: ${escapeHtml(e.message)}</p>`;
    }
}

function openApproveModal(id) {
    approveTargetId = id;
    const now = new Date();
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    document.getElementById('approve-start').value = toLocalDatetimeString(now);
    document.getElementById('approve-end').value = toLocalDatetimeString(defaultEnd);
    document.getElementById('approve-priority').value = 0;
    document.getElementById('approve-note').value = '';
    document.getElementById('approve-error').classList.add('d-none');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('approve-modal')).show();
}

function openRejectModal(id) {
    rejectTargetId = id;
    document.getElementById('reject-note').value = '';
    document.getElementById('reject-error').classList.add('d-none');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('reject-modal')).show();
}

async function confirmApprove() {
    const errorEl = document.getElementById('approve-error');
    const startVal = document.getElementById('approve-start').value;
    const endVal = document.getElementById('approve-end').value;
    const priority = parseInt(document.getElementById('approve-priority').value) || 0;
    const note = document.getElementById('approve-note').value.trim();
    if (!startVal || !endVal) {
        errorEl.textContent = 'Start and end dates are required.';
        errorEl.classList.remove('d-none');
        return;
    }
    const btn = document.getElementById('approve-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Approving...';
    try {
        const payload = {
            status: 'approved',
            active: true,
            startDate: Timestamp.fromDate(new Date(startVal)),
            endDate: Timestamp.fromDate(new Date(endVal)),
            priority,
            reviewedAt: serverTimestamp(),
            reviewedBy: auth.currentUser?.uid || null,
        };
        if (note) payload.reviewNote = note;
        await updateDoc(doc(db, 'ads', approveTargetId), payload);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('approve-modal')).hide();
        pendingResult('Approved.', true);
        resetPagination();
        await Promise.all([loadPendingAds(), loadAds()]);
    } catch (e) {
        errorEl.textContent = `Could not approve: ${e.message}`;
        errorEl.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Approve';
    }
}

async function confirmReject() {
    const errorEl = document.getElementById('reject-error');
    const note = document.getElementById('reject-note').value.trim();
    if (!note) {
        errorEl.textContent = 'Please tell the advertiser what needs to change.';
        errorEl.classList.remove('d-none');
        return;
    }
    const btn = document.getElementById('reject-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Rejecting...';
    try {
        await updateDoc(doc(db, 'ads', rejectTargetId), {
            status: 'rejected',
            active: false,
            reviewNote: note,
            reviewedAt: serverTimestamp(),
            reviewedBy: auth.currentUser?.uid || null,
        });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('reject-modal')).hide();
        pendingResult('Rejected.', true);
        await loadPendingAds();
    } catch (e) {
        errorEl.textContent = `Could not reject: ${e.message}`;
        errorEl.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Reject';
    }
}

export function initAds(fireDb, fireStorage, fireAuth) {
    db = fireDb;
    storage = fireStorage;
    auth = fireAuth;

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
        if (val) {
            preview.src = val;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
    });

    document.getElementById('ad-video').addEventListener('change', (e) => {
        const file = e.target.files[0] || null;
        if (file && file.size >= MAX_VIDEO_BYTES) {
            adResult(`Video must be under 10 MB (selected ${(file.size / 1048576).toFixed(1)} MB).`, false);
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

    document.getElementById('add-ad-btn').addEventListener('click', () => openAdForm());
    document.getElementById('cancel-ad-btn').addEventListener('click', closeAdForm);
    document.getElementById('save-ad-btn').addEventListener('click', saveAd);

    document.getElementById('approve-confirm-btn').addEventListener('click', confirmApprove);
    document.getElementById('reject-confirm-btn').addEventListener('click', confirmReject);
}
