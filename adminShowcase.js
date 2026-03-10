import { collection, doc, getDoc, setDoc, deleteDoc, getDocs, query, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

const URL_TYPES = ['youtube', 'instagram', 'facebook', 'tiktok', 'blog', 'twitter', 'x', 'other'];
let db, storage;
let editingShowcaseId = null;
let editingImageUrl = null;
let selectedImageFile = null;

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

function showcaseResult(msg, success) {
    const el = document.getElementById('showcase-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    setTimeout(() => el.classList.add('d-none'), 4000);
}

export async function loadShowcaseItems() {
    const listEl = document.getElementById('showcase-list');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        const q = query(collection(db, 'squabbitShowcase'), orderBy('date', 'desc'));
        const snap = await getDocs(q);
        if (snap.empty) {
            listEl.innerHTML = '<p class="text-muted small">No showcase items yet.</p>';
            return;
        }
        listEl.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const date = data.date?.toDate ? data.date.toDate().toLocaleDateString() : '';
            const urlCount = data.urls ? Object.keys(data.urls).length : 0;
            const div = document.createElement('div');
            div.className = 'showcase-item';
            div.innerHTML = `
                <img src="${data.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
                <div class="showcase-item-info">
                    <h6>${escapeHtml(data.title || '')}</h6>
                    <small>${date} · ${urlCount} URL${urlCount !== 1 ? 's' : ''}</small>
                </div>
                <div class="showcase-item-actions">
                    <button class="btn btn-outline-primary btn-sm sc-edit" data-id="${d.id}">Edit</button>
                    <button class="btn btn-outline-danger btn-sm sc-delete" data-id="${d.id}">Delete</button>
                </div>`;
            listEl.appendChild(div);
        });
        listEl.querySelectorAll('.sc-edit').forEach(btn =>
            btn.addEventListener('click', () => editShowcaseItem(btn.dataset.id)));
        listEl.querySelectorAll('.sc-delete').forEach(btn =>
            btn.addEventListener('click', () => deleteShowcaseItem(btn.dataset.id)));
    } catch (e) {
        listEl.innerHTML = '<p class="text-danger small">Error loading items: ' + escapeHtml(e.message) + '</p>';
    }
}

function addUrlRow(type = '', value = '') {
    const container = document.getElementById('showcase-urls');
    const row = document.createElement('div');
    row.className = 'url-row';
    row.innerHTML = `
        <select class="form-select form-select-sm url-type">
            ${URL_TYPES.map(t => `<option value="${t}" ${t === type ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input type="url" class="form-control form-control-sm url-value" placeholder="https://..." value="${escapeHtml(value)}" />
        <button type="button" class="btn btn-outline-danger btn-sm url-remove">&times;</button>`;
    container.appendChild(row);
    row.querySelector('.url-remove').addEventListener('click', () => row.remove());
}

function openShowcaseForm(item = null) {
    editingShowcaseId = item?.id || null;
    editingImageUrl = item?.imageUrl || null;
    selectedImageFile = null;
    document.getElementById('showcase-form-title').textContent = item ? 'Edit Showcase Item' : 'New Showcase Item';
    document.getElementById('showcase-title').value = item?.title || '';
    document.getElementById('showcase-date').value = item?.date?.toDate
        ? toLocalDatetimeString(item.date.toDate())
        : toLocalDatetimeString(new Date());
    document.getElementById('showcase-image').value = '';
    const preview = document.getElementById('showcase-image-preview');
    if (item?.imageUrl) {
        preview.src = item.imageUrl;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
    const urlsContainer = document.getElementById('showcase-urls');
    urlsContainer.innerHTML = '';
    if (item?.urls) {
        Object.entries(item.urls).forEach(([type, url]) => addUrlRow(type, url));
    }
    document.getElementById('showcase-form-section').style.display = 'block';
    document.getElementById('showcase-form-section').scrollIntoView({ behavior: 'smooth' });
}

function closeShowcaseForm() {
    document.getElementById('showcase-form-section').style.display = 'none';
    editingShowcaseId = null;
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

async function saveShowcaseItem() {
    const title = document.getElementById('showcase-title').value.trim();
    const dateVal = document.getElementById('showcase-date').value;
    if (!title) { showcaseResult('Title is required.', false); return; }
    if (!dateVal) { showcaseResult('Date is required.', false); return; }
    if (!editingShowcaseId && !selectedImageFile) { showcaseResult('Image is required for new items.', false); return; }

    const urls = {};
    document.querySelectorAll('.url-row').forEach(row => {
        const type = row.querySelector('.url-type').value;
        const val = row.querySelector('.url-value').value.trim();
        if (val) urls[type] = val;
    });

    const btn = document.getElementById('save-showcase-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const id = editingShowcaseId || crypto.randomUUID();
        let imageUrl = editingImageUrl;

        if (selectedImageFile) {
            const blob = await resizeImage(selectedImageFile);
            const storageRef = ref(storage, `squabbitShowcase/${id}`);
            await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
            imageUrl = await getDownloadURL(storageRef);

            if (editingShowcaseId && editingImageUrl) {
                try {
                    const oldPath = decodeURIComponent(new URL(editingImageUrl).pathname.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, oldPath));
                } catch (_) { /* old file may not exist */ }
            }
        }

        await setDoc(doc(db, 'squabbitShowcase', id), {
            id,
            title,
            date: Timestamp.fromDate(new Date(dateVal)),
            imageUrl,
            urls,
        });

        showcaseResult(editingShowcaseId ? 'Item updated.' : 'Item created.', true);
        closeShowcaseForm();
        await loadShowcaseItems();
    } catch (e) {
        showcaseResult('Error saving: ' + e.message, false);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

async function editShowcaseItem(id) {
    try {
        const docSnap = await getDoc(doc(db, 'squabbitShowcase', id));
        if (!docSnap.exists()) { showcaseResult('Item not found.', false); return; }
        openShowcaseForm({ id: docSnap.id, ...docSnap.data() });
    } catch (e) {
        showcaseResult('Error loading item: ' + e.message, false);
    }
}

async function deleteShowcaseItem(id) {
    if (!confirm('Delete this showcase item? This cannot be undone.')) return;
    try {
        const docRef = doc(db, 'squabbitShowcase', id);
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
        await deleteDoc(doc(db, 'squabbitShowcase', id));
        showcaseResult('Item deleted.', true);
        closeShowcaseForm();
        await loadShowcaseItems();
    } catch (e) {
        showcaseResult('Error deleting: ' + e.message, false);
    }
}

export function initShowcase(fireDb, fireStorage) {
    db = fireDb;
    storage = fireStorage;

    document.getElementById('showcase-image').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedImageFile = file;
        const preview = document.getElementById('showcase-image-preview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    });

    document.getElementById('add-showcase-btn').addEventListener('click', () => openShowcaseForm());
    document.getElementById('cancel-showcase-btn').addEventListener('click', closeShowcaseForm);
    document.getElementById('add-url-btn').addEventListener('click', () => addUrlRow());
    document.getElementById('save-showcase-btn').addEventListener('click', saveShowcaseItem);
}
