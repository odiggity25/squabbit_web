import { collection, doc, getDoc, getDocs, updateDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

let db;
// Full list held in memory so search filters client-side. Sorted newest-first by
// profile createdAt (profiles predating that field sort last).
let allAdvertisers = [];
let advertisersQuery = '';

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

function advertiserResult(msg, success) {
    const el = document.getElementById('advertiser-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(() => el.classList.add('d-none'), 4000);
}

// One pass over all ads to count how many each advertiser owns, so the list
// doesn't fire a separate count query per advertiser (was N+1).
async function adCountsByOwner() {
    const counts = new Map();
    try {
        const snap = await getDocs(collection(db, 'ads'));
        snap.docs.forEach((d) => {
            const ownerId = d.data().ownerId;
            if (ownerId) counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
        });
    } catch (_) { /* leave counts empty on failure */ }
    return counts;
}

export async function loadAdvertisers() {
    const listEl = document.getElementById('advertiser-list');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        const [snap, counts] = await Promise.all([getDocs(collection(db, 'advertisers')), adCountsByOwner()]);
        allAdvertisers = snap.docs.map((d) => ({ uid: d.id, ...d.data(), adCount: counts.get(d.id) || 0 }));
        // Newest profiles first; missing createdAt sorts to the bottom.
        allAdvertisers.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        renderAdvertisers();
    } catch (e) {
        listEl.innerHTML = `<p class="text-danger small">Error loading: ${escapeHtml(e.message)}</p>`;
    }
}

function advertiserMatches(a, q) {
    if (!q) return true;
    const hay = [a.brandName, a.contactEmail, a.website, a.uid].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
}

function renderAdvertisers() {
    const listEl = document.getElementById('advertiser-list');
    if (allAdvertisers.length === 0) {
        listEl.innerHTML = '<p class="text-muted small">No advertiser profiles yet.</p>';
        return;
    }
    const items = allAdvertisers.filter((a) => advertiserMatches(a, advertisersQuery));
    if (items.length === 0) {
        listEl.innerHTML = '<p class="text-muted small">No advertisers match your search.</p>';
        return;
    }
    listEl.innerHTML = '';
    for (const data of items) {
        const uid = data.uid;
        const created = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString() : 'unknown';
        const adCount = data.adCount;
        const row = document.createElement('div');
        row.className = 'ad-item';
        row.innerHTML = `
            <div class="ad-item-info">
                <h6>${escapeHtml(data.brandName || '(unnamed)')}</h6>
                <div class="small"><a href="${escapeHtml(data.website || '#')}" target="_blank" rel="noopener">${escapeHtml(data.website || '')}</a></div>
                <div class="small text-muted">${escapeHtml(data.contactEmail || '(no contact email)')}</div>
                <div class="small text-muted">Joined ${escapeHtml(created)} · ${adCount} ad${adCount === 1 ? '' : 's'}</div>
                <div class="small text-muted">uid: ${escapeHtml(uid)}</div>
            </div>
            <div class="ad-item-actions">
                <a class="btn btn-outline-primary btn-sm" href="/advertise/portal.html?viewAs=${encodeURIComponent(uid)}" target="_blank">View dashboard</a>
                <button class="btn btn-outline-secondary btn-sm advertiser-edit" data-uid="${escapeHtml(uid)}">Edit</button>
            </div>`;
        listEl.appendChild(row);
    }
    listEl.querySelectorAll('.advertiser-edit').forEach((btn) =>
        btn.addEventListener('click', () => openAdvertiserEdit(btn.dataset.uid)));
}

export function filterAdvertisers(q) {
    advertisersQuery = (q || '').trim().toLowerCase();
    renderAdvertisers();
}

async function openAdvertiserEdit(uid) {
    try {
        const snap = await getDoc(doc(db, 'advertisers', uid));
        if (!snap.exists()) { advertiserResult('Profile not found.', false); return; }
        const data = snap.data();
        document.getElementById('advertiser-edit-uid').value = uid;
        document.getElementById('advertiser-edit-brand').value = data.brandName || '';
        document.getElementById('advertiser-edit-email').value = data.contactEmail || '';
        document.getElementById('advertiser-edit-website').value = data.website || '';
        document.getElementById('advertiser-edit-error').classList.add('d-none');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('advertiser-edit-modal')).show();
    } catch (e) {
        advertiserResult('Could not load profile: ' + e.message, false);
    }
}

async function saveAdvertiserEdit() {
    const uid = document.getElementById('advertiser-edit-uid').value;
    const brandName = document.getElementById('advertiser-edit-brand').value.trim();
    const contactEmail = document.getElementById('advertiser-edit-email').value.trim();
    const website = document.getElementById('advertiser-edit-website').value.trim();
    const errorEl = document.getElementById('advertiser-edit-error');
    if (!brandName) {
        errorEl.textContent = 'Brand name is required.';
        errorEl.classList.remove('d-none');
        return;
    }
    const btn = document.getElementById('advertiser-edit-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await updateDoc(doc(db, 'advertisers', uid), { brandName, contactEmail, website });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('advertiser-edit-modal')).hide();
        advertiserResult('Profile updated.', true);
        await loadAdvertisers();
    } catch (e) {
        errorEl.textContent = 'Could not save: ' + e.message;
        errorEl.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

export function initAdvertisers(fireDb) {
    db = fireDb;
    document.getElementById('advertiser-edit-save-btn').addEventListener('click', saveAdvertiserEdit);
}
