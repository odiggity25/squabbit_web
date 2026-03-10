import { collection, doc, getDoc, setDoc, deleteDoc, getDocs, query, orderBy, limit, startAfter, Timestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

const URL_TYPES = ['youtube', 'instagram', 'facebook', 'tiktok', 'blog', 'twitter', 'x', 'other'];
let db, storage;
let editingShowcaseId = null;
let editingImageUrl = null;
let selectedImageFile = null;
let imageMode = 'file'; // 'file' or 'url'
const PAGE_SIZE = 5;
let pageCursors = [null]; // pageCursors[i] = doc to startAfter for page i (null = first page)
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
        const cursor = pageCursors[currentPage];
        const constraints = [collection(db, 'squabbitShowcase'), orderBy('date', 'desc'), limit(PAGE_SIZE)];
        if (cursor) constraints.push(startAfter(cursor));
        const snap = await getDocs(query(...constraints));
        lastPageSnapshot = snap;
        if (snap.empty && currentPage === 0) {
            listEl.innerHTML = '<p class="text-muted small">No showcase items yet.</p>';
            renderPagination();
            return;
        }
        listEl.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const date = data.date?.toDate ? data.date.toDate().toLocaleDateString() : '';
            const urlCount = data.urls ? Object.keys(data.urls).length : 0;
            const badges = [];
            if (data.enabled === false) badges.push('<span class="badge bg-secondary">Disabled</span>');
            if (data.internalPreview === true) badges.push('<span class="badge bg-warning text-dark">Internal Preview</span>');
            const div = document.createElement('div');
            div.className = 'showcase-item';
            div.innerHTML = `
                <img src="${data.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
                <div class="showcase-item-info">
                    <h6>${escapeHtml(data.title || '')} ${badges.join(' ')}</h6>
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
        // Store cursor for next page if we got a full page
        if (snap.docs.length === PAGE_SIZE && !pageCursors[currentPage + 1]) {
            pageCursors[currentPage + 1] = snap.docs[snap.docs.length - 1];
        }
        renderPagination();
    } catch (e) {
        listEl.innerHTML = '<p class="text-danger small">Error loading items: ' + escapeHtml(e.message) + '</p>';
    }
}

function resetPagination() {
    pageCursors = [null];
    currentPage = 0;
    lastPageSnapshot = null;
}

function renderPagination() {
    let paginationEl = document.getElementById('showcase-pagination');
    if (!paginationEl) {
        paginationEl = document.createElement('div');
        paginationEl.id = 'showcase-pagination';
        paginationEl.className = 'd-flex justify-content-between mt-2';
        document.getElementById('showcase-list').after(paginationEl);
    }
    const hasPrev = currentPage > 0;
    const hasNext = lastPageSnapshot && lastPageSnapshot.docs.length === PAGE_SIZE;
    if (!hasPrev && !hasNext) {
        paginationEl.innerHTML = '';
        return;
    }
    paginationEl.innerHTML = `
        <button class="btn btn-outline-secondary btn-sm ${hasPrev ? '' : 'invisible'}" id="showcase-prev">&#8592; Previous</button>
        <button class="btn btn-outline-secondary btn-sm ${hasNext ? '' : 'invisible'}" id="showcase-next">Next &#8594;</button>`;
    if (hasPrev) {
        paginationEl.querySelector('#showcase-prev').addEventListener('click', () => {
            currentPage--;
            loadShowcaseItems();
        });
    }
    if (hasNext) {
        paginationEl.querySelector('#showcase-next').addEventListener('click', () => {
            currentPage++;
            loadShowcaseItems();
        });
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
    setImageMode('file');
    document.getElementById('showcase-form-title').textContent = item ? 'Edit Showcase Item' : 'New Showcase Item';
    document.getElementById('showcase-title').value = item?.title || '';
    document.getElementById('showcase-date').value = item?.date?.toDate
        ? toLocalDatetimeString(item.date.toDate())
        : toLocalDatetimeString(new Date());
    document.getElementById('showcase-enabled').checked = item?.enabled !== false;
    document.getElementById('showcase-internal-preview').checked = item?.internalPreview === true;
    document.getElementById('showcase-image').value = '';
    document.getElementById('showcase-image-url').value = '';
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
    document.getElementById('showcase-list-section').style.display = 'none';
    document.getElementById('showcase-form-section').style.display = 'block';
}

function setImageMode(mode) {
    imageMode = mode;
    const fileInput = document.getElementById('showcase-image');
    const urlInput = document.getElementById('showcase-image-url');
    const fileBtn = document.getElementById('image-mode-file');
    const urlBtn = document.getElementById('image-mode-url');
    fileInput.classList.toggle('d-none', mode !== 'file');
    urlInput.classList.toggle('d-none', mode !== 'url');
    fileBtn.classList.toggle('active', mode === 'file');
    urlBtn.classList.toggle('active', mode === 'url');
}

function closeShowcaseForm() {
    document.getElementById('showcase-form-section').style.display = 'none';
    document.getElementById('showcase-list-section').style.display = 'block';
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
    const imageUrlInput = document.getElementById('showcase-image-url').value.trim();
    const hasNewImage = selectedImageFile || (imageMode === 'url' && imageUrlInput);
    if (!editingShowcaseId && !hasNewImage) { showcaseResult('Image is required for new items.', false); return; }

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

        let imageFile = selectedImageFile;
        if (!imageFile && imageMode === 'url' && imageUrlInput) {
            const resp = await fetch(imageUrlInput);
            if (!resp.ok) throw new Error('Failed to fetch image from URL');
            const fetchedBlob = await resp.blob();
            imageFile = new File([fetchedBlob], 'image.jpg', { type: fetchedBlob.type });
        }

        if (imageFile) {
            const blob = await resizeImage(imageFile);
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

        const enabled = document.getElementById('showcase-enabled').checked;
        const internalPreview = document.getElementById('showcase-internal-preview').checked;

        await setDoc(doc(db, 'squabbitShowcase', id), {
            id,
            title,
            date: Timestamp.fromDate(new Date(dateVal)),
            imageUrl,
            urls,
            enabled,
            internalPreview,
        });

        showcaseResult(editingShowcaseId ? 'Item updated.' : 'Item created.', true);
        closeShowcaseForm();
        resetPagination();
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
        resetPagination();
        await loadShowcaseItems();
    } catch (e) {
        showcaseResult('Error deleting: ' + e.message, false);
    }
}

async function loadBlogPosts() {
    const select = document.getElementById('from-blog-select');
    try {
        const resp = await fetch('/blog.html');
        const html = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('.blog-entry-link').forEach(link => {
            const title = link.querySelector('.blog-title')?.textContent.trim();
            const imgSrc = link.querySelector('.blog-image')?.getAttribute('src') || '';
            const href = link.getAttribute('href') || '';
            if (title) {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ title, imgSrc, href });
                opt.textContent = title;
                select.appendChild(opt);
            }
        });
    } catch (_) {
        // blog.html not available — leave dropdown empty
    }
}

function createFromBlogPost(data) {
    const { title, imgSrc, href } = JSON.parse(data);
    openShowcaseForm();
    document.getElementById('showcase-title').value = title;

    // Set image from blog thumbnail URL
    const fullImgUrl = new URL(imgSrc, window.location.origin).href;
    setImageMode('url');
    document.getElementById('showcase-image-url').value = fullImgUrl;
    const preview = document.getElementById('showcase-image-preview');
    preview.src = fullImgUrl;
    preview.style.display = 'block';

    // Add blog URL
    const fullHref = new URL(href, window.location.origin).href;
    addUrlRow('blog', fullHref);
}

export function initShowcase(fireDb, fireStorage) {
    db = fireDb;
    storage = fireStorage;

    loadBlogPosts();

    document.getElementById('showcase-image').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedImageFile = file;
        const preview = document.getElementById('showcase-image-preview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    });

    document.getElementById('image-mode-file').addEventListener('click', () => setImageMode('file'));
    document.getElementById('image-mode-url').addEventListener('click', () => setImageMode('url'));
    document.getElementById('showcase-image-url').addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const preview = document.getElementById('showcase-image-preview');
        if (val) {
            preview.src = val;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
    });

    document.getElementById('from-blog-select').addEventListener('change', (e) => {
        if (e.target.value) {
            createFromBlogPost(e.target.value);
            e.target.value = '';
        }
    });

    document.getElementById('add-showcase-btn').addEventListener('click', () => openShowcaseForm());
    document.getElementById('cancel-showcase-btn').addEventListener('click', closeShowcaseForm);
    document.getElementById('add-url-btn').addEventListener('click', () => addUrlRow());
    document.getElementById('save-showcase-btn').addEventListener('click', saveShowcaseItem);
}
