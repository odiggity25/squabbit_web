import { collection, doc, getDoc, updateDoc, deleteDoc, getDocs, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

// Ads + Pending Review lists for the admin Ads tab. Editing an ad lives on its
// own page (admin-ad.html) so it opens the same way from either list; this module
// only renders the lists, runs client-side search, and handles approve/reject/delete.
let db, storage;
let auth;
const advertiserCache = new Map();
const PAGE_SIZE = 10;

// Full datasets held in memory so search + paging are pure client-side (per the
// "basic search bar, filter client side" brief). Each list keeps its own query.
let allAds = [];
let adsQuery = '';
let adsPage = 0;
let pendingAdsCache = [];
let pendingQuery = '';
let approveTargetId = null;
let rejectTargetId = null;

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

function adResult(msg, success) {
    const el = document.getElementById('ad-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(() => el.classList.add('d-none'), 4000);
}

function pendingResult(msg, success) {
    const el = document.getElementById('pending-ads-result');
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    el.classList.remove('d-none');
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

function goToEditor(id, from) {
    location.href = `admin-ad.html?id=${encodeURIComponent(id)}&from=${from}`;
}

// True if the ad matches the current search text. Checks the ad's own creative /
// status fields plus the advertiser brand (when already in cache from rendering).
function adMatches(ad, q) {
    if (!q) return true;
    const brand = advertiserCache.get(ad.ownerId)?.brandName || '';
    const hay = [ad.title, ad.companyName, ad.body, ad.url, ad.status, ad.ownerId, brand]
        .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
}

function adBadges(data) {
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
        if (startDate && endDate && now >= startDate && now <= endDate) badges.push('<span class="badge bg-success">Live</span>');
        else if (startDate && now < startDate) badges.push('<span class="badge bg-info text-dark">Scheduled</span>');
        else if (endDate && now > endDate) badges.push('<span class="badge bg-secondary">Expired</span>');
    }
    return badges;
}

export async function loadAds() {
    const listEl = document.getElementById('ad-list');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        // Order by createdAt (present on every ad) — NOT startDate, which is now
        // optional; a Firestore orderBy silently drops docs missing the field.
        const snap = await getDocs(query(collection(db, 'ads'), orderBy('createdAt', 'desc')));
        allAds = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Warm the advertiser cache so brand names show and search can match them.
        await Promise.all([...new Set(allAds.map((a) => a.ownerId).filter(Boolean))].map((id) => getAdvertiser(id)));
        adsPage = 0;
        await renderAds();
    } catch (e) {
        listEl.innerHTML = '<p class="text-danger small">Error loading ads: ' + escapeHtml(e.message) + '</p>';
    }
}

async function renderAds() {
    const listEl = document.getElementById('ad-list');
    const filtered = allAds.filter((a) => adMatches(a, adsQuery));
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (adsPage > pageCount - 1) adsPage = pageCount - 1;
    const pageItems = filtered.slice(adsPage * PAGE_SIZE, adsPage * PAGE_SIZE + PAGE_SIZE);

    if (filtered.length === 0) {
        listEl.innerHTML = adsQuery
            ? '<p class="text-muted small">No ads match your search.</p>'
            : '<p class="text-muted small">No ads yet.</p>';
        renderAdsPagination(0);
        return;
    }
    listEl.innerHTML = '';
    for (const data of pageItems) {
        const start = data.startDate?.toDate ? data.startDate.toDate().toLocaleDateString() : '';
        const end = data.endDate?.toDate ? data.endDate.toDate().toLocaleDateString() : '';
        const badges = adBadges(data);
        const advertiser = data.ownerId ? await getAdvertiser(data.ownerId) : null;
        const advertiserLine = advertiser
            ? `<div class="small text-muted">Advertiser: ${escapeHtml(advertiser.brandName || data.ownerId)}</div>`
            : '';
        const div = document.createElement('div');
        div.className = 'ad-item';
        div.innerHTML = `
            <img src="${data.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
            <div class="ad-item-info">
                <h6>${escapeHtml(data.title || '(no title)')}</h6>
                ${badges.length ? `<div class="mb-1">${badges.join(' ')}</div>` : ''}
                ${advertiserLine}
                <div class="small"><strong>Budget:</strong> ${escapeHtml(adBudgetText(data))} · <strong>Audience:</strong> ${escapeHtml(adAudienceText(data))}</div>
                <small>${start} – ${end} · P${data.priority ?? 0} · ${data.impressions ?? 0} views (${data.uniqueViews ?? 0} unique) · ${data.clicks ?? 0} clicks · ${data.dismissals ?? 0} not interested</small>
            </div>
            <div class="ad-item-actions">
                <button class="btn btn-outline-primary btn-sm ad-edit" data-id="${data.id}">Edit</button>
                <button class="btn btn-outline-danger btn-sm ad-delete" data-id="${data.id}">Delete</button>
            </div>`;
        listEl.appendChild(div);
    }
    listEl.querySelectorAll('.ad-edit').forEach((btn) =>
        btn.addEventListener('click', () => goToEditor(btn.dataset.id, 'ads')));
    listEl.querySelectorAll('.ad-delete').forEach((btn) =>
        btn.addEventListener('click', () => deleteAd(btn.dataset.id)));
    renderAdsPagination(pageCount);
}

function renderAdsPagination(pageCount) {
    let paginationEl = document.getElementById('ad-pagination');
    if (!paginationEl) {
        paginationEl = document.createElement('div');
        paginationEl.id = 'ad-pagination';
        paginationEl.className = 'd-flex justify-content-between align-items-center mt-2';
        document.getElementById('ad-list').after(paginationEl);
    }
    if (pageCount <= 1) { paginationEl.innerHTML = ''; return; }
    const hasPrev = adsPage > 0;
    const hasNext = adsPage < pageCount - 1;
    paginationEl.innerHTML = `
        <button class="btn btn-outline-secondary btn-sm ${hasPrev ? '' : 'invisible'}" id="ad-prev">&#8592; Previous</button>
        <span class="small text-muted">Page ${adsPage + 1} of ${pageCount}</span>
        <button class="btn btn-outline-secondary btn-sm ${hasNext ? '' : 'invisible'}" id="ad-next">Next &#8594;</button>`;
    if (hasPrev) paginationEl.querySelector('#ad-prev').addEventListener('click', () => { adsPage--; renderAds(); });
    if (hasNext) paginationEl.querySelector('#ad-next').addEventListener('click', () => { adsPage++; renderAds(); });
}

export function filterAds(q) {
    adsQuery = (q || '').trim().toLowerCase();
    adsPage = 0;
    renderAds();
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
        await Promise.all([loadAds(), loadPendingAds()]);
    } catch (e) {
        adResult('Error deleting: ' + e.message, false);
    }
}

// Renders the AI pre-screen verdict for a pending ad so the admin sees the
// machine's read before approving. Auto-rejected ads never reach this list.
function aiVerdictHtml(ad) {
    const m = ad.aiModeration;
    if (!m || !m.verdict) return '';
    const reasons = Array.isArray(m.reasons) && m.reasons.length
        ? `<div class="small text-muted">${escapeHtml(m.reasons.join(' '))}</div>` : '';
    if (m.verdict === 'clear') return '<div class="small mt-1"><span class="badge bg-success">AI: clear</span></div>';
    if (m.verdict === 'reject') return `<div class="small mt-1"><span class="badge bg-danger">AI: flagged</span></div>${reasons}`;
    return `<div class="small mt-1"><span class="badge bg-warning text-dark">AI: needs review</span></div>${reasons}`;
}

function pendingMatches(ad, q) {
    if (!q) return true;
    const brand = advertiserCache.get(ad.ownerId)?.brandName || '';
    const hay = [ad.title, ad.companyName, ad.body, ad.url, ad.ownerId, brand]
        .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
}

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
        countEl.classList.toggle('d-none', pendingAdsCache.length === 0);
        await Promise.all([...new Set(pendingAdsCache.map((a) => a.ownerId).filter(Boolean))].map((id) => getAdvertiser(id)));
        await renderPending();
    } catch (e) {
        listEl.innerHTML = `<p class="text-danger small">Error loading: ${escapeHtml(e.message)}</p>`;
    }
}

async function renderPending() {
    const listEl = document.getElementById('pending-ads-list');
    const items = pendingAdsCache.filter((ad) => pendingMatches(ad, pendingQuery));
    if (pendingAdsCache.length === 0) {
        listEl.innerHTML = '<p class="text-muted small">No pending submissions.</p>';
        return;
    }
    if (items.length === 0) {
        listEl.innerHTML = '<p class="text-muted small">No pending ads match your search.</p>';
        return;
    }
    listEl.innerHTML = '';
    for (const ad of items) {
        const advertiser = ad.ownerId ? await getAdvertiser(ad.ownerId) : null;
        const brand = advertiser?.brandName || ad.ownerId || 'Unknown advertiser';
        const submitted = ad.submittedAt?.toDate ? ad.submittedAt.toDate().toLocaleString() : '';
        const previewBadges = [];
        if (ad.internalPreview === true) previewBadges.push('<span class="badge bg-warning text-dark">Internal Preview</span>');
        if (Array.isArray(ad.previewUserIds) && ad.previewUserIds.length > 0) previewBadges.push(`<span class="badge bg-info text-dark">${ad.previewUserIds.length} preview user${ad.previewUserIds.length === 1 ? '' : 's'}</span>`);
        const div = document.createElement('div');
        div.className = 'ad-item';
        div.innerHTML = `
            <img src="${ad.imageUrl || ''}" alt="" onerror="this.style.display='none'" />
            <div class="ad-item-info">
                <h6>${escapeHtml(ad.title || '(no title)')}</h6>
                ${previewBadges.length ? `<div class="mb-1">${previewBadges.join(' ')}</div>` : ''}
                <div class="small"><strong>${escapeHtml(brand)}</strong>${advertiser?.contactEmail ? ' · ' + escapeHtml(advertiser.contactEmail) : ''}${advertiser?.website ? ' · <a href="' + escapeHtml(advertiser.website) + '" target="_blank" rel="noopener">' + escapeHtml(advertiser.website) + '</a>' : ''}</div>
                <div class="small text-muted">${escapeHtml(ad.body || '')}</div>
                <div class="small text-muted">URL: ${escapeHtml(ad.url || '')}</div>
                <div class="small text-muted">Submitted ${escapeHtml(submitted)}</div>
                <div class="small"><strong>Budget:</strong> ${escapeHtml(adBudgetText(ad))} · <strong>Audience:</strong> ${escapeHtml(adAudienceText(ad))}</div>
                ${aiVerdictHtml(ad)}
            </div>
            <div class="ad-item-actions">
                <button class="btn btn-outline-primary btn-sm pending-edit" data-id="${ad.id}">Edit</button>
                <button class="btn btn-success btn-sm pending-approve" data-id="${ad.id}">Approve</button>
                <button class="btn btn-outline-danger btn-sm pending-reject" data-id="${ad.id}">Reject</button>
            </div>`;
        listEl.appendChild(div);
    }
    listEl.querySelectorAll('.pending-edit').forEach((btn) =>
        btn.addEventListener('click', () => goToEditor(btn.dataset.id, 'pending')));
    listEl.querySelectorAll('.pending-approve').forEach((btn) =>
        btn.addEventListener('click', () => openApproveModal(btn.dataset.id)));
    listEl.querySelectorAll('.pending-reject').forEach((btn) =>
        btn.addEventListener('click', () => openRejectModal(btn.dataset.id)));
}

export function filterPending(q) {
    pendingQuery = (q || '').trim().toLowerCase();
    renderPending();
}

// A read-only summary of the schedule the advertiser chose when they built the ad.
function scheduleSummaryHtml(ad) {
    const start = ad.startDate?.toDate ? ad.startDate.toDate() : null;
    const end = ad.endDate?.toDate ? ad.endDate.toDate() : null;
    const fmt = (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const startText = start ? `Starts ${escapeHtml(fmt(start))}` : 'Starts as soon as approved';
    const endText = end ? `Ends ${escapeHtml(fmt(end))}` : 'Runs until the budget is spent';
    return `<div>${startText}</div><div>${endText}</div>`;
}

function adCreativeCardHtml(ad) {
    const hidden = new Set(Array.isArray(ad.hiddenFields) ? ad.hiddenFields : []);
    const company = !hidden.has('companyName') && ad.companyName ? `<div class="small text-muted">${escapeHtml(ad.companyName)}</div>` : '';
    const title = !hidden.has('title') && ad.title ? `<div class="fw-semibold">${escapeHtml(ad.title)}</div>` : '';
    const body = !hidden.has('body') && ad.body ? `<div class="small text-muted">${escapeHtml(ad.body)}</div>` : '';
    const url = ad.url ? `<div class="small"><a href="${escapeHtml(ad.url)}" target="_blank" rel="noopener">${escapeHtml(ad.url)}</a></div>` : '';
    return `
        <div class="ad-item">
            <img src="${escapeHtml(ad.imageUrl || '')}" alt="" onerror="this.style.display='none'" />
            <div class="ad-item-info">${company}${title}${body}${url}</div>
        </div>`;
}

function adBudgetText(ad) {
    const cents = Number(ad.budgetCents) || 0;
    if (!cents) return 'Not funded';
    const impr = Number(ad.targetImpressions) || 0;
    return `$${(cents / 100).toFixed(2)}${impr ? ` · ~${impr.toLocaleString()} impressions` : ''}`;
}

function adAudienceText(ad) {
    const c = Array.isArray(ad.targetCountries) ? ad.targetCountries : [];
    return c.length ? c.join(', ') : 'Everywhere';
}

function openApproveModal(id) {
    approveTargetId = id;
    const ad = (pendingAdsCache || []).find((a) => a.id === id) || {};
    const advertiser = advertiserCache.get(ad.ownerId);
    const brand = advertiser?.brandName || ad.ownerId || '';
    const who = brand + (advertiser?.contactEmail ? ` · ${advertiser.contactEmail}` : '');
    document.getElementById('approve-preview').innerHTML =
        (who ? `<div class="small text-muted mb-2">${escapeHtml(who)}</div>` : '') + adCreativeCardHtml(ad);
    document.getElementById('approve-budget').textContent = adBudgetText(ad);
    document.getElementById('approve-audience').textContent = adAudienceText(ad);
    document.getElementById('approve-schedule').innerHTML = scheduleSummaryHtml(ad);
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
    const priority = parseInt(document.getElementById('approve-priority').value) || 0;
    const note = document.getElementById('approve-note').value.trim();
    const btn = document.getElementById('approve-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Approving...';
    try {
        // Don't touch startDate/endDate — the advertiser owns the schedule (and can
        // edit it live). Approving just flips it live with the admin-set priority.
        const payload = {
            status: 'approved',
            active: true,
            priority,
            reviewedAt: serverTimestamp(),
            reviewedBy: auth.currentUser?.uid || null,
        };
        if (note) payload.reviewNote = note;
        await updateDoc(doc(db, 'ads', approveTargetId), payload);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('approve-modal')).hide();
        pendingResult('Approved.', true);
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

    document.getElementById('add-ad-btn').addEventListener('click', () => { location.href = 'admin-ad.html?from=ads'; });
    document.getElementById('approve-confirm-btn').addEventListener('click', confirmApprove);
    document.getElementById('reject-confirm-btn').addEventListener('click', confirmReject);
}
