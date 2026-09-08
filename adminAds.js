import { collection, doc, getDoc, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

// Ads + Pending Review lists for the admin Ads tab. Both lists are now just
// clickable rows: opening an ad goes to its own page (admin-ad.html), where all
// the actions live (edit, approve, pause/resume, reject, delete). This module
// only renders the lists and runs the client-side search.
let db;
const advertiserCache = new Map();
const PAGE_SIZE = 10;

// Full datasets held in memory so search + paging are pure client-side (per the
// "basic search bar, filter client side" brief). Each list keeps its own query.
let allAds = [];
let adsQuery = '';
let adsPage = 0;
let pendingAdsCache = [];
let pendingQuery = '';

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
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

// ----- Shared ad-row building blocks -----
// The approved and pending lists render the same creative shell (thumbnail +
// title + advertiser + budget/audience) through these helpers, then each layers
// on its own extras and actions. Keeping the shell here stops the two drifting.

function adBadgesHtml(badges) {
    return badges.length ? `<div class="mb-1">${badges.join(' ')}</div>` : '';
}

function adAdvertiserLine(advertiser, ownerId, { website = false } = {}) {
    if (!advertiser && !ownerId) return '';
    const brand = escapeHtml(advertiser?.brandName || ownerId || 'Unknown advertiser');
    const email = advertiser?.contactEmail ? ` · ${escapeHtml(advertiser.contactEmail)}` : '';
    const site = website && advertiser?.website
        ? ` · <a href="${escapeHtml(advertiser.website)}" target="_blank" rel="noopener">${escapeHtml(advertiser.website)}</a>`
        : '';
    return `<div class="small text-muted">Advertiser: ${brand}${email}${site}</div>`;
}

function adBudgetAudienceLine(ad) {
    return `<div class="small"><strong>Budget:</strong> ${escapeHtml(adBudgetText(ad))} · <strong>Audience:</strong> ${escapeHtml(adAudienceText(ad))}</div>`;
}

// Builds the inner HTML for one .ad-item row: thumbnail + title + the caller's
// section rows (in order, blanks skipped) + optional right-side action buttons.
function adItemInnerHtml({ imageUrl, title, sections, actionsHtml }) {
    return `
        <img src="${imageUrl || ''}" alt="" onerror="this.style.display='none'" />
        <div class="ad-item-info">
            <h6>${escapeHtml(title || '(no title)')}</h6>
            ${sections.filter(Boolean).join('\n')}
        </div>
        ${actionsHtml ? `<div class="ad-item-actions">${actionsHtml}</div>` : ''}`;
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
        const advertiser = data.ownerId ? await getAdvertiser(data.ownerId) : null;
        const stats = `<small>${start} – ${end} · P${data.priority ?? 0} · ${data.impressions ?? 0} views (${data.uniqueViews ?? 0} unique) · ${data.clicks ?? 0} clicks · ${data.dismissals ?? 0} not interested</small>`;
        // The whole row opens the ad (edit + delete both live on the ad page).
        const div = document.createElement('div');
        div.className = 'ad-item ad-item-open';
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        div.setAttribute('aria-label', `Open ${data.title || 'ad'}`);
        div.innerHTML = adItemInnerHtml({
            imageUrl: data.imageUrl,
            title: data.title,
            sections: [
                adBadgesHtml(adBadges(data)),
                adAdvertiserLine(advertiser, data.ownerId),
                adBudgetAudienceLine(data),
                stats,
            ],
        });
        div.addEventListener('click', () => goToEditor(data.id, 'ads'));
        div.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToEditor(data.id, 'ads'); }
        });
        listEl.appendChild(div);
    }
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
        const submitted = ad.submittedAt?.toDate ? ad.submittedAt.toDate().toLocaleString() : '';
        const previewBadges = [];
        if (ad.internalPreview === true) previewBadges.push('<span class="badge bg-warning text-dark">Internal Preview</span>');
        if (Array.isArray(ad.previewUserIds) && ad.previewUserIds.length > 0) previewBadges.push(`<span class="badge bg-info text-dark">${ad.previewUserIds.length} preview user${ad.previewUserIds.length === 1 ? '' : 's'}</span>`);
        // The whole row opens the ad; approve / reject / edit all live on the ad page.
        const div = document.createElement('div');
        div.className = 'ad-item ad-item-open';
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        div.setAttribute('aria-label', `Open ${ad.title || 'ad'}`);
        div.innerHTML = adItemInnerHtml({
            imageUrl: ad.imageUrl,
            title: ad.title,
            sections: [
                adBadgesHtml(previewBadges),
                adAdvertiserLine(advertiser, ad.ownerId, { website: true }),
                ad.body ? `<div class="small text-muted">${escapeHtml(ad.body)}</div>` : '',
                ad.url ? `<div class="small text-muted">URL: ${escapeHtml(ad.url)}</div>` : '',
                submitted ? `<div class="small text-muted">Submitted ${escapeHtml(submitted)}</div>` : '',
                adBudgetAudienceLine(ad),
                aiVerdictHtml(ad),
            ],
        });
        div.addEventListener('click', () => goToEditor(ad.id, 'pending'));
        div.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToEditor(ad.id, 'pending'); }
        });
        listEl.appendChild(div);
    }
}

export function filterPending(q) {
    pendingQuery = (q || '').trim().toLowerCase();
    renderPending();
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

export function initAds(fireDb) {
    db = fireDb;
    document.getElementById('add-ad-btn').addEventListener('click', () => { location.href = 'admin-ad.html?from=ads'; });
}
