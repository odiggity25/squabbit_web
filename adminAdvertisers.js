import { collection, doc, getDoc, getDocs, updateDoc, query, where } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

let db;

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

async function countAds(ownerId) {
    const snap = await getDocs(query(collection(db, 'ads'), where('ownerId', '==', ownerId)));
    return snap.size;
}

export async function loadAdvertisers() {
    const listEl = document.getElementById('advertiser-list');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        const snap = await getDocs(collection(db, 'advertisers'));
        if (snap.empty) {
            listEl.innerHTML = '<p class="text-muted small">No advertiser profiles yet.</p>';
            return;
        }
        listEl.innerHTML = '';
        for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const uid = docSnap.id;
            const adCount = await countAds(uid);
            const row = document.createElement('div');
            row.className = 'ad-item';
            row.innerHTML = `
                <div class="ad-item-info">
                    <h6>${escapeHtml(data.brandName || '(unnamed)')}</h6>
                    <div class="small"><a href="${escapeHtml(data.website || '#')}" target="_blank" rel="noopener">${escapeHtml(data.website || '')}</a></div>
                    <div class="small text-muted">${escapeHtml(data.contactEmail || '(no contact email)')}</div>
                    <div class="small text-muted">uid: ${escapeHtml(uid)} · ${adCount} ad${adCount === 1 ? '' : 's'}</div>
                </div>
                <div class="ad-item-actions">
                    <a class="btn btn-outline-primary btn-sm" href="/advertise/portal.html?viewAs=${encodeURIComponent(uid)}" target="_blank">View dashboard</a>
                    <button class="btn btn-outline-secondary btn-sm advertiser-edit" data-uid="${escapeHtml(uid)}">Edit</button>
                </div>`;
            listEl.appendChild(row);
        }
        listEl.querySelectorAll('.advertiser-edit').forEach((btn) =>
            btn.addEventListener('click', () => openAdvertiserEdit(btn.dataset.uid)));
    } catch (e) {
        listEl.innerHTML = `<p class="text-danger small">Error loading: ${escapeHtml(e.message)}</p>`;
    }
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
