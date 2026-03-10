import { collection, doc, getDoc, setDoc, deleteDoc, getDocs, query, orderBy, limit, startAfter, Timestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

let db, storage;
let editingAdId = null;
let editingImageUrl = null;
let selectedImageFile = null;
let imageMode = 'file';
const PAGE_SIZE = 5;
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
    const el = document.getElementById('ad-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    setTimeout(() => el.classList.add('d-none'), 4000);
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
        snap.forEach(d => {
            const data = d.data();
            const start = data.startDate?.toDate ? data.startDate.toDate().toLocaleDateString() : '';
            const end = data.endDate?.toDate ? data.endDate.toDate().toLocaleDateString() : '';
            const badges = [];
            if (data.internalPreview === true) badges.push('<span class="badge bg-warning text-dark">Internal Preview</span>');
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
            const div = document.createElement('div');
            div.className = 'ad-item';
            div.innerHTML = `
                <img src="${data.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
                <div class="ad-item-info">
                    <h6>${escapeHtml(data.title || '')} ${badges.join(' ')}</h6>
                    <small>${start} – ${end} · P${data.priority ?? 0} · ${data.impressions ?? 0} views · ${data.clicks ?? 0} clicks</small>
                </div>
                <div class="ad-item-actions">
                    <button class="btn btn-outline-primary btn-sm ad-edit" data-id="${d.id}">Edit</button>
                    <button class="btn btn-outline-danger btn-sm ad-delete" data-id="${d.id}">Delete</button>
                </div>`;
            listEl.appendChild(div);
        });
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

function openAdForm(item = null) {
    editingAdId = item?.id || null;
    editingImageUrl = item?.imageUrl || null;
    selectedImageFile = null;
    setImageMode('file');
    document.getElementById('ad-form-title').textContent = item ? 'Edit Ad' : 'New Ad';
    document.getElementById('ad-title').value = item?.title || '';
    document.getElementById('ad-body').value = item?.body || '';
    document.getElementById('ad-url').value = item?.url || '';
    document.getElementById('ad-priority').value = item?.priority ?? 0;
    document.getElementById('ad-min-version').value = item?.minAppVersion ?? 0;
    document.getElementById('ad-active').checked = item?.active !== false;
    document.getElementById('ad-internal-preview').checked = item?.internalPreview === true;

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
    const preview = document.getElementById('ad-image-preview');
    if (item?.imageUrl) {
        preview.src = item.imageUrl;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
    document.getElementById('ad-list-section').style.display = 'none';
    document.getElementById('ad-form-section').style.display = 'block';
}

function closeAdForm() {
    document.getElementById('ad-form-section').style.display = 'none';
    document.getElementById('ad-list-section').style.display = 'block';
    editingAdId = null;
    editingImageUrl = null;
    selectedImageFile = null;
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
    const title = document.getElementById('ad-title').value.trim();
    const body = document.getElementById('ad-body').value.trim();
    const url = document.getElementById('ad-url').value.trim();
    const startDateVal = document.getElementById('ad-start-date').value;
    const endDateVal = document.getElementById('ad-end-date').value;
    const priority = parseInt(document.getElementById('ad-priority').value) || 0;
    const minAppVersion = parseInt(document.getElementById('ad-min-version').value) || 0;
    const active = document.getElementById('ad-active').checked;

    if (!title) { adResult('Title is required.', false); return; }
    if (!startDateVal || !endDateVal) { adResult('Start and end dates are required.', false); return; }

    const imageUrlInput = document.getElementById('ad-image-url').value.trim();
    const hasNewImage = selectedImageFile || (imageMode === 'url' && imageUrlInput);
    if (!editingAdId && !hasNewImage) { adResult('Image is required for new ads.', false); return; }

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
            const blob = await resizeImage(imageFile);
            const storageRef = ref(storage, `ads/${id}`);
            await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
            imageUrl = await getDownloadURL(storageRef);

            if (editingAdId && editingImageUrl) {
                try {
                    const oldPath = decodeURIComponent(new URL(editingImageUrl).pathname.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, oldPath));
                } catch (_) { /* old file may not exist */ }
            }
        }

        const docData = {
            id,
            title,
            body,
            url,
            startDate: Timestamp.fromDate(new Date(startDateVal)),
            endDate: Timestamp.fromDate(new Date(endDateVal)),
            priority,
            minAppVersion,
            active,
            internalPreview: document.getElementById('ad-internal-preview').checked,
            imageUrl,
        };

        // Preserve impressions/clicks on edit
        if (editingAdId) {
            const existing = await getDoc(doc(db, 'ads', id));
            if (existing.exists()) {
                const d = existing.data();
                docData.impressions = d.impressions ?? 0;
                docData.clicks = d.clicks ?? 0;
            }
        } else {
            docData.impressions = 0;
            docData.clicks = 0;
        }

        await setDoc(doc(db, 'ads', id), docData);

        adResult(editingAdId ? 'Ad updated.' : 'Ad created.', true);
        closeAdForm();
        resetPagination();
        await loadAds();
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
        }
        await deleteDoc(doc(db, 'ads', id));
        adResult('Ad deleted.', true);
        closeAdForm();
        resetPagination();
        await loadAds();
    } catch (e) {
        adResult('Error deleting: ' + e.message, false);
    }
}

export function initAds(fireDb, fireStorage) {
    db = fireDb;
    storage = fireStorage;

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

    document.getElementById('add-ad-btn').addEventListener('click', () => openAdForm());
    document.getElementById('cancel-ad-btn').addEventListener('click', closeAdForm);
    document.getElementById('save-ad-btn').addEventListener('click', saveAd);
}
