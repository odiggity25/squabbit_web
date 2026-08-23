import {
    auth,
    db,
    storage,
    requireSignedIn,
    signOutUser,
    escapeHtml,
    formatDate,
} from '/advertise/shared.js';
import { functions } from '/advertise/shared.js';
import { renderPreview } from '/advertise/ad-preview.js';
import { renderAdChart } from '/advertise/ad-chart.js';
import { COUNTRIES, countryName } from '/advertise/countries.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

const CPM_CENTS = 1500; // $15 per 1,000 impressions
const formatMoney = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
const impressionsForDollars = (dollars) => Math.floor((dollars * 100 * 1000) / CPM_CENTS);
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    collection,
    getDocs,
    query,
    where,
    orderBy,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;

const state = {
    user: null,
    advertiser: null,
    adId: null,
    adDoc: null, // last loaded server doc, or null for new
    selectedImageFile: null,
    selectedVideoFile: null,
    removeVideo: false,
    viewAsUid: null,
    isAdminPreview: false,
    editable: true, // false for admin preview and non-draft statuses
    targetCountries: [], // ISO alpha-2 codes; empty = worldwide
    fieldHidden: { companyName: false, title: false, body: false }, // preview/save toggles
};

// Eye / eye-off icons for the per-field show/hide toggles (feather style).
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

const loadingEl = document.getElementById('loading');
const signedOutEl = document.getElementById('signed-out-view');
const notAuthorizedEl = document.getElementById('not-authorized-view');
const editorEl = document.getElementById('editor-view');
const resultEl = document.getElementById('ad-result');

const companyEl = document.getElementById('ad-company');
const titleEl = document.getElementById('ad-title');
const bodyEl = document.getElementById('ad-body');
const urlEl = document.getElementById('ad-url');
const imageEl = document.getElementById('ad-image');
const imagePreviewEl = document.getElementById('ad-image-preview');
const videoEl = document.getElementById('ad-video');
const videoPreviewEl = document.getElementById('ad-video-preview');
const videoStatusEl = document.getElementById('ad-video-status');
const videoRemoveBtn = document.getElementById('ad-video-remove');
const countrySearchEl = document.getElementById('ad-country-search');
const countryChipsEl = document.getElementById('country-chips');
const countryOptionsEl = document.getElementById('country-options');
const previewTarget = document.getElementById('ad-preview-card');

function showResult(msg, kind) {
    resultEl.className = `alert alert-${kind}`;
    resultEl.textContent = msg;
    resultEl.classList.remove('d-none');
    // Ensure the message is on screen — it sits at the top of the form, so a tap
    // on a button lower down would otherwise leave it out of view.
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => resultEl.classList.add('d-none'), 4000);
}

function getQueryAdId() {
    return new URLSearchParams(window.location.search).get('id');
}

function getViewAsUid() {
    return new URLSearchParams(window.location.search).get('viewAs');
}

document.getElementById('sign-out-btn').addEventListener('click', () => signOutUser());

requireSignedIn(async (user, advertiser) => {
    loadingEl.style.display = 'none';
    if (!user) {
        signedOutEl.style.display = 'block';
        return;
    }
    state.viewAsUid = getViewAsUid();
    state.adId = getQueryAdId();

    // Admin preview path: load the target advertiser's profile and the ad doc
    // without enforcing ownership. Read access is gated by isMeAdmin() so a
    // non-admin user hitting this URL gets permission-denied on the profile
    // fetch and we fall back to the standard path.
    if (state.viewAsUid && state.adId) {
        try {
            const { getAdvertiser } = await import('/advertise/shared.js');
            const targetAdvertiser = await getAdvertiser(state.viewAsUid);
            if (targetAdvertiser) {
                const snap = await getDoc(doc(db, 'ads', state.adId));
                if (!snap.exists() || snap.data().ownerId !== state.viewAsUid) {
                    notAuthorizedEl.style.display = 'block';
                    return;
                }
                state.user = { uid: state.viewAsUid };
                state.advertiser = targetAdvertiser;
                state.adDoc = snap.data();
                state.isAdminPreview = true;
                editorEl.style.display = 'block';
                renderAdminPreviewChrome(targetAdvertiser);
                populateForm();
                updatePreview();
                lockFormForAdminPreview();
                renderActivityLog();
                renderAdGraph();
                return;
            }
        } catch (e) {
            console.warn('admin preview lookup failed:', e);
        }
        // Fall through to normal mode if the lookup failed.
    }

    if (!advertiser) {
        window.location.href = '/advertise/portal.html';
        return;
    }
    state.user = user;
    state.advertiser = advertiser;
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
    renderActivityLog();
    renderAdGraph();
});

function renderAdminPreviewChrome(targetAdvertiser) {
    // Swap the editor header back link to point at the admin-preview portal URL,
    // and replace sign-out with "Back to admin".
    const headerLink = document.querySelector('.editor-header a.text-muted');
    if (headerLink) {
        headerLink.textContent = '← Back to portal preview';
        headerLink.setAttribute('href', `/advertise/portal.html?viewAs=${encodeURIComponent(state.viewAsUid)}`);
    }
    // Clone-replace the sign-out button so the existing signOutUser listener
    // doesn't also fire — that would sign the admin out of Firebase before the
    // navigation completes, dumping them on the login screen when they return.
    const oldBtn = document.getElementById('sign-out-btn');
    if (oldBtn) {
        const newBtn = oldBtn.cloneNode(true);
        newBtn.textContent = '← Back to admin';
        oldBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', () => { window.location.href = '/admin.html'; });
    }
    // Banner.
    const editor = document.getElementById('editor-view');
    const banner = document.createElement('div');
    banner.className = 'admin-preview-banner';
    banner.innerHTML = `<strong>Admin preview</strong> &middot; Inspecting ${escapeHtml(targetAdvertiser.brandName)}'s ad. Form is read-only.`;
    editor.insertBefore(banner, editor.firstChild);
}

function lockFormForAdminPreview() {
    state.editable = false;
    const inputs = document.querySelectorAll('#editor-view input, #editor-view textarea, #editor-view select, #editor-view .field-toggle');
    inputs.forEach((el) => { el.disabled = true; });
    const hide = ['save-draft-btn', 'submit-btn', 'stop-edit-btn', 'delete-btn', 'ad-video-remove'];
    hide.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // Drop the dashed form-text helper lines since they're meaningless in preview.
    document.querySelectorAll('#editor-view .form-text').forEach((el) => { el.style.display = 'none'; });
}

// Enables/disables the creative inputs. A live/pending/completed ad is read-only
// until the advertiser stops it (which sends the edit back through review).
function setEditorReadOnly(readOnly) {
    state.editable = !readOnly;
    const inputs = document.querySelectorAll('#editor-view input, #editor-view textarea, #editor-view select, #editor-view .field-toggle');
    inputs.forEach((el) => { el.disabled = readOnly; });
}

function populateForm() {
    if (state.adDoc) {
        document.getElementById('editor-title').textContent = 'Edit ad';
        companyEl.value = state.adDoc.companyName || '';
        titleEl.value = state.adDoc.title || '';
        bodyEl.value = state.adDoc.body || '';
        urlEl.value = state.adDoc.url || '';
        if (state.adDoc.imageUrl) {
            imagePreviewEl.src = state.adDoc.imageUrl;
            imagePreviewEl.style.display = 'block';
        }
        state.targetCountries = Array.isArray(state.adDoc.targetCountries) ? [...state.adDoc.targetCountries] : [];
        updateVideoStatus();
    } else {
        document.getElementById('editor-title').textContent = 'New ad';
        // Prefill the company name with the advertiser's brand so it matches the
        // preview. It's editable and can be cleared or hidden.
        companyEl.value = state.advertiser?.brandName || '';
    }
    state.fieldHidden = { companyName: false, title: false, body: false };
    ['companyName', 'title', 'body'].forEach(applyFieldToggle);
    renderCountryChips();
    // Only drafts and rejected ads are editable in place. Live/pending/completed
    // ads are read-only until stopped, so an edit re-enters review.
    const s = state.adDoc ? status() : 'new';
    setEditorReadOnly(!(s === 'new' || s === 'draft' || s === 'rejected'));
    updateStatusBanner();
    updateButtonVisibility();
    updateStatsPanel();
}

function status() {
    return state.adDoc?.status || 'draft';
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    const s = status();
    let cls = 'status-draft';
    let text = 'Draft — save changes, then submit when ready.';
    if (!state.adDoc) {
        banner.style.display = 'none';
        return;
    }
    if (s === 'pending') {
        cls = 'status-pending';
        const when = formatDate(state.adDoc.submittedAt);
        text = `In review${when ? ` — submitted ${when}` : ''}. We'll email you when it's approved.`;
    } else if (s === 'approved') {
        cls = 'status-approved';
        const start = formatDate(state.adDoc.startDate);
        const end = formatDate(state.adDoc.endDate);
        text = `Approved — live${start && end ? ` from ${start} to ${end}` : ''}. To change it, use Stop & edit; changes get a quick re-review.`;
    } else if (s === 'completed') {
        cls = 'status-approved';
        text = 'Completed — this campaign has delivered its budget.';
    } else if (s === 'rejected') {
        cls = 'status-rejected';
        const note = state.adDoc.reviewNote ? ` Reviewer note: ${state.adDoc.reviewNote}` : '';
        text = `Needs changes.${note} Edit and resubmit.`;
    }
    banner.className = `status-banner ${cls}`;
    banner.textContent = text;
    banner.style.display = 'block';
}

function updateButtonVisibility() {
    const submitBtn = document.getElementById('submit-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const saveBtn = document.getElementById('save-draft-btn');
    const stopBtn = document.getElementById('stop-edit-btn');
    const s = state.adDoc ? status() : 'new';
    const editable = s === 'new' || s === 'draft' || s === 'rejected';
    // Save + Submit only while editable.
    saveBtn.style.display = editable ? '' : 'none';
    submitBtn.style.display = editable ? '' : 'none';
    submitBtn.textContent = (state.adDoc && Number(state.adDoc.budgetCents) > 0)
        ? 'Resubmit for review'
        : 'Submit for review';
    saveBtn.textContent = 'Save draft';
    // Stop & edit only for a running (approved) ad.
    stopBtn.style.display = s === 'approved' ? '' : 'none';
    // Top up a running or completed ad.
    document.getElementById('topup-btn').style.display = (s === 'approved' || s === 'completed') ? '' : 'none';
    // Delete only for a draft/rejected ad that was never funded.
    deleteBtn.style.display = (editable && !(state.adDoc && Number(state.adDoc.budgetCents) > 0)) ? '' : 'none';
}

function updateStatsPanel() {
    const panel = document.getElementById('stats-panel');
    if (state.adDoc && state.adDoc.status === 'approved') {
        panel.style.display = 'block';
        const impressions = state.adDoc.impressions ?? 0;
        const uniqueViews = state.adDoc.uniqueViews ?? 0;
        const clicks = state.adDoc.clicks ?? 0;
        const dismissals = state.adDoc.dismissals ?? 0;
        document.getElementById('stat-impressions').textContent = impressions.toLocaleString();
        document.getElementById('stat-unique').textContent = uniqueViews.toLocaleString();
        document.getElementById('stat-clicks').textContent = clicks.toLocaleString();
        document.getElementById('stat-dismissals').textContent = dismissals.toLocaleString();
        document.getElementById('stat-ctr').textContent = impressions > 0
            ? `${((clicks / impressions) * 100).toFixed(1)}%`
            : '—';
    } else {
        panel.style.display = 'none';
    }
}

const ACTIVITY_LABELS = {
    created: 'Ad created',
    creativeUpdated: 'Creative updated',
    submitted: 'Submitted for review',
    approved: 'Approved',
    rejected: 'Changes requested',
    paused: 'Paused',
    resumed: 'Resumed',
    scheduleChanged: 'Schedule updated',
    nowPublic: 'Went public',
    wentLive: 'Went live',
    ended: 'Campaign ended',
};

const FIELD_LABELS = {
    title: 'headline',
    body: 'body',
    url: 'click-through URL',
    imageUrl: 'image',
    videoUrl: 'video',
    companyName: 'company name',
};

function tsToDate(v) {
    if (!v) return null;
    return v.toDate ? v.toDate() : new Date(v);
}

function activityDetail(ev) {
    if (ev.type === 'creativeUpdated' && Array.isArray(ev.details?.fields)) {
        return `Updated ${ev.details.fields.map((f) => FIELD_LABELS[f] || f).join(', ')}.`;
    }
    if (ev.type === 'rejected' && ev.details?.note) {
        return `Note: ${ev.details.note}`;
    }
    return '';
}

// Renders the advertiser-visible activity timeline. Stored events come from
// ads/{id}/events (audience == 'advertiser'); "went live"/"ended" are derived
// from the ad's own dates rather than stored. Sorted newest-first client-side so
// no composite index is needed. Non-critical: any failure just hides the panel.
// Renders a date+time in the viewer's own locale and timezone (seconds included so
// a precise go-live reads exactly, e.g. "Jun 5, 2026, 3:35:21 PM").
function formatWhen(d) {
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

function formatDuration(ms) {
    if (ms == null || ms < 0) return '';
    const totalMin = Math.floor(ms / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0) return `${d} day${d === 1 ? '' : 's'}${h ? `, ${h} hr${h === 1 ? '' : 's'}` : ''}`;
    if (h > 0) return `${h} hr${h === 1 ? '' : 's'}${m ? `, ${m} min` : ''}`;
    return `${m} min`;
}

// Cumulative time the ad has actually been live, summing live spans and excluding
// paused gaps. A span starts at go-live or a "resumed" event and ends at a "paused"
// event, the end date, or now (whichever comes first).
function computeLiveDuration(loggedEvents, goLive, now, endDate, status) {
    if (!goLive || status !== 'approved') return null;
    const points = [{ t: goLive, type: 'start' }];
    for (const e of loggedEvents) {
        if (!e.when) continue;
        if (e.type === 'resumed') points.push({ t: e.when, type: 'start' });
        if (e.type === 'paused') points.push({ t: e.when, type: 'stop' });
    }
    points.sort((a, b) => a.t - b.t);
    let total = 0;
    let liveSince = null;
    for (const p of points) {
        if (p.type === 'start' && liveSince === null) liveSince = p.t;
        else if (p.type === 'stop' && liveSince !== null) { total += p.t - liveSince; liveSince = null; }
    }
    if (liveSince !== null) {
        const endpoint = endDate && now > endDate ? endDate : now;
        total += Math.max(0, endpoint - liveSince);
    }
    return total;
}

async function renderActivityLog() {
    const panel = document.getElementById('activity-log');
    const list = document.getElementById('activity-list');
    const summaryEl = document.getElementById('live-summary');
    if (!state.adId) { panel.style.display = 'none'; return; }
    let loggedEvents = [];
    try {
        const snap = await getDocs(query(
            collection(db, 'ads', state.adId, 'events'),
            where('audience', '==', 'advertiser'),
        ));
        loggedEvents = snap.docs.map((d) => {
            const data = d.data();
            return { type: data.type, details: data.details || {}, when: tsToDate(data.at) };
        });
    } catch (e) {
        console.warn('activity log unavailable:', e.message);
        panel.style.display = 'none';
        return;
    }

    const now = new Date();
    // Prefer the recorded go-live instant; fall back to the scheduled start date.
    const goLive = tsToDate(state.adDoc?.wentLiveAt) || tsToDate(state.adDoc?.startDate);
    const end = tsToDate(state.adDoc?.endDate);

    const entries = [...loggedEvents];
    if (goLive && now >= goLive && state.adDoc?.status === 'approved') {
        entries.push({ type: 'wentLive', details: {}, when: goLive });
    }
    if (end && now > end) {
        entries.push({ type: 'ended', details: {}, when: end });
    }

    const ordered = entries.filter((e) => e.when).sort((a, b) => b.when - a.when);
    if (ordered.length === 0) { panel.style.display = 'none'; return; }

    if (summaryEl) {
        const liveMs = computeLiveDuration(loggedEvents, goLive, now, end, state.adDoc?.status);
        if (liveMs != null) {
            const stillLive = !(end && now > end) && state.adDoc?.active !== false;
            summaryEl.textContent = `Live for ${formatDuration(liveMs)}${stillLive ? ' and counting' : ''} · since ${formatWhen(goLive)}`;
            summaryEl.style.display = 'block';
        } else {
            summaryEl.style.display = 'none';
        }
    }

    list.innerHTML = ordered.map((e) => {
        const detail = activityDetail(e);
        return `
            <li class="activity-item">
                <div class="activity-item-label">${escapeHtml(ACTIVITY_LABELS[e.type] || e.type)}</div>
                ${detail ? `<div class="activity-item-detail">${escapeHtml(detail)}</div>` : ''}
                <div class="activity-item-date">${escapeHtml(formatWhen(e.when))}</div>
            </li>`;
    }).join('');
    panel.style.display = 'block';
}

// Fills missing calendar days (from the first day with data through today) with
// zeros so the line is continuous rather than jumping across gaps.
function buildDailySeries(days) {
    const map = new Map(days.map((d) => [d.date, d]));
    const sorted = [...map.keys()].sort();
    if (sorted.length === 0) return [];
    const first = sorted[0];
    const today = new Date().toISOString().slice(0, 10);
    const lastKey = sorted[sorted.length - 1] > today ? sorted[sorted.length - 1] : today;
    const out = [];
    const cur = new Date(`${first}T00:00:00Z`);
    const end = new Date(`${lastKey}T00:00:00Z`);
    while (cur <= end) {
        const key = cur.toISOString().slice(0, 10);
        const d = map.get(key) || {};
        out.push({ date: key, impressions: d.impressions || 0, uniqueViews: d.uniqueViews || 0, clicks: d.clicks || 0 });
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

// Pairs paused -> resumed events into spans; an unclosed pause runs to now.
function pausedSpansFromEvents(events, now) {
    const sorted = events
        .filter((e) => (e.type === 'paused' || e.type === 'resumed') && e.when)
        .sort((a, b) => a.when - b.when);
    const spans = [];
    let pauseStart = null;
    for (const e of sorted) {
        if (e.type === 'paused' && pauseStart === null) pauseStart = e.when;
        else if (e.type === 'resumed' && pauseStart !== null) { spans.push({ from: pauseStart, to: e.when }); pauseStart = null; }
    }
    if (pauseStart !== null) spans.push({ from: pauseStart, to: now });
    return spans;
}

async function renderAdGraph() {
    const panel = document.getElementById('graph-panel');
    const note = document.getElementById('graph-note');
    const canvas = document.getElementById('ad-graph');
    if (!state.adId) { panel.style.display = 'none'; return; }
    let days = [];
    try {
        const snap = await getDocs(collection(db, 'ads', state.adId, 'days'));
        days = snap.docs.map((d) => ({ date: d.id, ...d.data() }));
    } catch (e) {
        console.warn('graph data unavailable:', e.message);
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';
    if (days.length === 0) {
        note.textContent = 'Daily breakdown appears here once viewers on the latest app version start seeing this ad. Your totals above are already accurate.';
        note.style.display = 'block';
        canvas.style.display = 'none';
        return;
    }
    note.style.display = 'none';
    canvas.style.display = 'block';

    const now = new Date();
    const series = buildDailySeries(days);
    const goLive = tsToDate(state.adDoc?.wentLiveAt) || tsToDate(state.adDoc?.startDate);
    const end = tsToDate(state.adDoc?.endDate);

    let events = [];
    try {
        const esnap = await getDocs(query(
            collection(db, 'ads', state.adId, 'events'),
            where('audience', '==', 'advertiser'),
        ));
        events = esnap.docs.map((d) => { const x = d.data(); return { type: x.type, when: tsToDate(x.at) }; });
    } catch (_) { /* markers are optional */ }
    const pausedSpans = pausedSpansFromEvents(events, now);

    try {
        await renderAdChart(canvas, { series, goLive, endDate: end, pausedSpans, now });
    } catch (e) {
        console.warn('chart render failed:', e.message);
        note.textContent = 'Chart could not be loaded.';
        note.style.display = 'block';
        canvas.style.display = 'none';
    }
}

document.getElementById('refresh-stats-btn').addEventListener('click', async () => {
    if (!state.adId) return;
    const snap = await getDoc(doc(db, 'ads', state.adId));
    if (snap.exists()) {
        state.adDoc = snap.data();
        updateStatsPanel();
    }
});

async function submitForReview() {
    // Auto-create the draft if it hasn't been saved yet, so submitting a brand-new
    // ad just works. saveDraft shows its own reason (e.g. image required) on failure.
    if (!state.adId) {
        const saved = await saveDraft();
        if (!saved) return;
    }
    if (!state.adDoc) {
        showResult('Could not save your ad. Please try again.', 'danger');
        return;
    }
    const s = status();
    if (s !== 'draft' && s !== 'rejected') {
        showResult('Only drafts and rejected ads can be submitted.', 'danger');
        return;
    }
    if (!urlEl.value.trim()) {
        showResult('Add a click-through URL before submitting.', 'danger');
        return;
    }
    if (!state.adDoc.imageUrl) {
        showResult('Add an image before submitting.', 'danger');
        return;
    }
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
        // Save current creative first (no status change — funding sets that
        // server-side after the wallet check).
        await updateDoc(doc(db, 'ads', state.adId), {
            companyName: fieldValue('companyName', companyEl),
            title: fieldValue('title', titleEl),
            body: fieldValue('body', bodyEl),
            url: urlEl.value.trim(),
            targetCountries: state.targetCountries,
            lastUpdatedAt: serverTimestamp(),
        });
        // Synchronous AI pre-screen. Only a clear violation blocks; anything else
        // proceeds to the funding step (needs_review is flagged for admin).
        const modResult = await httpsCallable(functions, 'moderateAdSubmission')({ adId: state.adId });
        if (modResult.data && modResult.data.verdict === 'reject') {
            const reasons = (modResult.data.reasons || []).join(' ')
                || "It doesn't meet our advertising guidelines.";
            showResult(`Not approved: ${reasons}`, 'danger');
            btn.disabled = false;
            btn.textContent = 'Submit for review';
            return;
        }
        // Already-funded ad being re-submitted after an edit: re-commit its
        // remaining budget and go straight back to review (no funding step).
        if (Number(state.adDoc.budgetCents) > 0) {
            btn.textContent = 'Resubmitting…';
            await resubmitFundedAd();
            btn.disabled = false;
            btn.textContent = 'Resubmit for review';
            return;
        }
        btn.disabled = false;
        btn.textContent = 'Submit for review';
        await showFundingPanel();
    } catch (e) {
        showResult(`Could not submit: ${e.message}`, 'danger');
        btn.disabled = false;
        btn.textContent = 'Submit for review';
    }
}

async function resubmitFundedAd() {
    try {
        await httpsCallable(functions, 'resubmitAd')({ adId: state.adId });
        showResult("Resubmitted for review. We'll email you when it's approved.", 'success');
        setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 1000);
    } catch (e) {
        if (e.message === 'INSUFFICIENT_BALANCE') {
            const shortfall = (e.details && e.details.shortfallCents) || 0;
            showResult(`Not enough balance to resume. Add ${formatMoney(shortfall)} on the portal, then resubmit.`, 'danger');
        } else {
            showResult(e.message || 'Could not resubmit.', 'danger');
        }
    }
}

async function stopAndEdit() {
    if (!confirm('Stop this ad so you can edit it? It stops showing now and goes back through review after you resubmit. Your stats and remaining budget are kept.')) return;
    const btn = document.getElementById('stop-edit-btn');
    btn.disabled = true;
    btn.textContent = 'Stopping…';
    try {
        await httpsCallable(functions, 'stopAd')({ adId: state.adId });
        window.location.reload();
    } catch (e) {
        showResult(e.message || 'Could not stop the ad.', 'danger');
        btn.disabled = false;
        btn.textContent = 'Stop & edit';
    }
}

document.getElementById('stop-edit-btn').addEventListener('click', stopAndEdit);

// ── Top up (add budget to a running/completed ad) ─────────────
function updateTopupImpressions() {
    const dollars = Math.floor(Number(document.getElementById('topup-amount').value)) || 0;
    document.getElementById('topup-impressions').textContent =
        `Adds ≈ ${impressionsForDollars(dollars).toLocaleString()} impressions at $15 per 1,000`;
}

async function showTopupPanel() {
    document.querySelector('.editor-actions').style.display = 'none';
    document.getElementById('topup-panel').style.display = 'block';
    document.getElementById('topup-error').classList.add('d-none');
    document.getElementById('topup-addfunds-btn').classList.add('d-none');
    let balanceCents = 0;
    try {
        const snap = await getDoc(doc(db, 'advertisers', state.user.uid));
        if (snap.exists()) balanceCents = Number(snap.data().balanceCents) || 0;
    } catch (_) { /* show 0 */ }
    state.balanceCents = balanceCents;
    document.getElementById('topup-balance').textContent = `Your balance: ${formatMoney(balanceCents)}`;
    // If the ad ended because its end date passed, require a new end date to resume.
    const end = state.adDoc?.endDate?.toDate ? state.adDoc.endDate.toDate() : null;
    const endedByDate = end && new Date() > end;
    document.getElementById('topup-enddate-row').style.display = endedByDate ? 'block' : 'none';
    updateTopupImpressions();
    document.getElementById('topup-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideTopupPanel() {
    document.getElementById('topup-panel').style.display = 'none';
    document.querySelector('.editor-actions').style.display = '';
}

async function submitTopup() {
    const errEl = document.getElementById('topup-error');
    errEl.classList.add('d-none');
    document.getElementById('topup-addfunds-btn').classList.add('d-none');
    const dollars = Math.floor(Number(document.getElementById('topup-amount').value));
    if (!Number.isFinite(dollars) || dollars < 10) {
        errEl.textContent = 'Enter at least $10.';
        errEl.classList.remove('d-none');
        return;
    }
    const addCents = dollars * 100;
    const endInput = document.getElementById('topup-enddate');
    const endRowShown = document.getElementById('topup-enddate-row').style.display !== 'none';
    if (endRowShown && !endInput.value) {
        errEl.textContent = 'Pick a new end date to resume this campaign.';
        errEl.classList.remove('d-none');
        return;
    }
    const newEndDateMillis = endInput.value ? Date.parse(`${endInput.value}T23:59:59`) : 0;
    const btn = document.getElementById('topup-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
        await httpsCallable(functions, 'topUpAd')({ adId: state.adId, addCents, newEndDateMillis });
        showResult('Budget added. Your ad keeps running.', 'success');
        setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 1000);
    } catch (e) {
        if (e.message === 'INSUFFICIENT_BALANCE') {
            const shortfall = (e.details && e.details.shortfallCents) || Math.max(0, addCents - (state.balanceCents || 0));
            errEl.textContent = `Not enough balance — you need ${formatMoney(shortfall)} more.`;
            errEl.classList.remove('d-none');
            const addBtn = document.getElementById('topup-addfunds-btn');
            addBtn.textContent = `Add ${formatMoney(shortfall)}`;
            addBtn.dataset.amount = String(Math.max(1000, Math.ceil(shortfall / 100) * 100));
            addBtn.classList.remove('d-none');
        } else {
            errEl.textContent = e.message || 'Could not top up.';
            errEl.classList.remove('d-none');
        }
        btn.disabled = false;
        btn.textContent = 'Add budget';
    }
}

async function topupAddFunds() {
    const addBtn = document.getElementById('topup-addfunds-btn');
    const amountCents = Number(addBtn.dataset.amount) || 1000;
    addBtn.disabled = true;
    addBtn.textContent = 'Redirecting…';
    try {
        const res = await httpsCallable(functions, 'createAdFundsCheckout')({ amountCents, testMode: localStorage.getItem('sqAdTestMode') === '1' });
        const url = res.data && res.data.url;
        if (!url) throw new Error('No checkout URL returned.');
        window.location.href = url;
    } catch (e) {
        document.getElementById('topup-error').textContent = e.message || 'Could not start checkout.';
        document.getElementById('topup-error').classList.remove('d-none');
        addBtn.disabled = false;
        addBtn.textContent = 'Add funds';
    }
}

document.getElementById('topup-btn').addEventListener('click', showTopupPanel);
document.getElementById('topup-cancel-btn').addEventListener('click', hideTopupPanel);
document.getElementById('topup-submit-btn').addEventListener('click', submitTopup);
document.getElementById('topup-addfunds-btn').addEventListener('click', topupAddFunds);
document.getElementById('topup-amount').addEventListener('input', updateTopupImpressions);
document.querySelectorAll('#topup-panel .topup-preset').forEach((b) =>
    b.addEventListener('click', () => { document.getElementById('topup-amount').value = b.dataset.amt; updateTopupImpressions(); }));

// ── Funding step (shown after the ad passes the AI pre-screen) ──
function showFundingError(msg) {
    const el = document.getElementById('funding-error');
    el.textContent = msg;
    el.classList.remove('d-none');
}

function updateFundImpressions() {
    const dollars = Math.floor(Number(document.getElementById('fund-budget').value)) || 0;
    document.getElementById('fund-impressions').textContent =
        `≈ ${impressionsForDollars(dollars).toLocaleString()} impressions at $15 per 1,000`;
}

async function showFundingPanel() {
    document.querySelector('.editor-actions').style.display = 'none';
    document.getElementById('funding-panel').style.display = 'block';
    document.getElementById('funding-error').classList.add('d-none');
    document.getElementById('funding-addfunds-btn').classList.add('d-none');
    let balanceCents = 0;
    try {
        const snap = await getDoc(doc(db, 'advertisers', state.user.uid));
        if (snap.exists()) balanceCents = Number(snap.data().balanceCents) || 0;
    } catch (_) { /* show 0 */ }
    state.balanceCents = balanceCents;
    document.getElementById('fund-balance').textContent = `Your balance: ${formatMoney(balanceCents)}`;
    updateFundImpressions();
    document.getElementById('funding-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideFundingPanel() {
    document.getElementById('funding-panel').style.display = 'none';
    document.querySelector('.editor-actions').style.display = '';
}

async function submitFunding() {
    document.getElementById('funding-error').classList.add('d-none');
    document.getElementById('funding-addfunds-btn').classList.add('d-none');
    const dollars = Math.floor(Number(document.getElementById('fund-budget').value));
    if (!Number.isFinite(dollars) || dollars < 10) {
        showFundingError('Enter a budget of at least $10.');
        return;
    }
    const budgetCents = dollars * 100;
    const btn = document.getElementById('funding-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
        await httpsCallable(functions, 'fundAd')({ adId: state.adId, budgetCents });
        showResult("Submitted for review. We'll email you when it's approved.", 'success');
        setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 1000);
    } catch (e) {
        if (e.message === 'INSUFFICIENT_BALANCE') {
            const shortfall = (e.details && e.details.shortfallCents) || Math.max(0, budgetCents - (state.balanceCents || 0));
            showFundingError(`Not enough balance — you need ${formatMoney(shortfall)} more. Add funds, then submit.`);
            const addBtn = document.getElementById('funding-addfunds-btn');
            addBtn.textContent = `Add ${formatMoney(shortfall)}`;
            addBtn.dataset.amount = String(Math.max(1000, Math.ceil(shortfall / 100) * 100));
            addBtn.classList.remove('d-none');
        } else {
            showFundingError(e.message || 'Could not submit.');
        }
        btn.disabled = false;
        btn.textContent = 'Fund & submit';
    }
}

async function addFundsForShortfall() {
    const addBtn = document.getElementById('funding-addfunds-btn');
    const amountCents = Number(addBtn.dataset.amount) || 1000;
    addBtn.disabled = true;
    addBtn.textContent = 'Redirecting…';
    try {
        const res = await httpsCallable(functions, 'createAdFundsCheckout')({ amountCents, testMode: localStorage.getItem('sqAdTestMode') === '1' });
        const url = res.data && res.data.url;
        if (!url) throw new Error('No checkout URL returned.');
        window.location.href = url;
    } catch (e) {
        showFundingError(e.message || 'Could not start checkout.');
        addBtn.disabled = false;
        addBtn.textContent = 'Add funds';
    }
}

document.getElementById('fund-budget').addEventListener('input', updateFundImpressions);
document.querySelectorAll('#funding-panel .fund-preset').forEach((b) =>
    b.addEventListener('click', () => { document.getElementById('fund-budget').value = b.dataset.amt; updateFundImpressions(); }));
document.getElementById('funding-cancel-btn').addEventListener('click', hideFundingPanel);
document.getElementById('funding-submit-btn').addEventListener('click', submitFunding);
document.getElementById('funding-addfunds-btn').addEventListener('click', addFundsForShortfall);

async function deleteAd() {
    if (!state.adId || !state.adDoc) return;
    const s = status();
    if (s !== 'draft' && s !== 'rejected') {
        showResult('Only drafts and rejected ads can be deleted.', 'danger');
        return;
    }
    if (!confirm('Delete this ad? This cannot be undone.')) return;
    try {
        if (state.adDoc.imageUrl) {
            try {
                const oldPath = decodeURIComponent(new URL(state.adDoc.imageUrl).pathname.split('/o/')[1].split('?')[0]);
                await deleteObject(ref(storage, oldPath));
            } catch (_) { /* may not exist */ }
        }
        if (state.adDoc.videoUrl) {
            try {
                const oldPath = decodeURIComponent(new URL(state.adDoc.videoUrl).pathname.split('/o/')[1].split('?')[0]);
                await deleteObject(ref(storage, oldPath));
            } catch (_) { /* may not exist */ }
        }
        await deleteDoc(doc(db, 'ads', state.adId));
        window.location.href = '/advertise/portal.html';
    } catch (e) {
        showResult(`Could not delete: ${e.message}`, 'danger');
    }
}

document.getElementById('submit-btn').addEventListener('click', submitForReview);
document.getElementById('delete-btn').addEventListener('click', deleteAd);

function updateVideoStatus() {
    if (state.selectedVideoFile) {
        videoStatusEl.textContent = `Selected: ${state.selectedVideoFile.name} (${(state.selectedVideoFile.size / 1048576).toFixed(1)} MB)`;
        videoRemoveBtn.classList.add('d-none');
        videoPreviewEl.src = URL.createObjectURL(state.selectedVideoFile);
        videoPreviewEl.style.display = 'block';
    } else if (state.adDoc?.videoUrl && !state.removeVideo) {
        videoStatusEl.textContent = 'This ad has a video attached.';
        videoRemoveBtn.classList.remove('d-none');
        videoPreviewEl.src = state.adDoc.videoUrl;
        videoPreviewEl.style.display = 'block';
    } else if (state.removeVideo) {
        videoStatusEl.textContent = 'Video will be removed on save.';
        videoRemoveBtn.classList.add('d-none');
        videoPreviewEl.removeAttribute('src');
        videoPreviewEl.style.display = 'none';
    } else {
        videoStatusEl.textContent = '';
        videoRemoveBtn.classList.add('d-none');
        videoPreviewEl.removeAttribute('src');
        videoPreviewEl.style.display = 'none';
    }
}

// ── Country targeting picker ─────────────────────────────────
// state.targetCountries holds ISO alpha-2 codes; an empty list means worldwide.

function renderCountryChips() {
    if (state.targetCountries.length === 0) {
        countryChipsEl.innerHTML = '';
        return;
    }
    countryChipsEl.innerHTML = state.targetCountries.map((code) => `
        <span class="country-chip">${escapeHtml(countryName(code))}
            <button type="button" data-code="${escapeHtml(code)}" aria-label="Remove ${escapeHtml(countryName(code))}">&times;</button>
        </span>`).join('');
    countryChipsEl.querySelectorAll('button[data-code]').forEach((btn) =>
        btn.addEventListener('click', () => toggleCountry(btn.dataset.code)));
}

function renderCountryOptions() {
    const term = countrySearchEl.value.trim().toLowerCase();
    const matches = COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term));
    if (matches.length === 0) {
        countryOptionsEl.innerHTML = '<div class="country-option-empty">No countries match.</div>';
        return;
    }
    countryOptionsEl.innerHTML = matches.map((c) => {
        const selected = state.targetCountries.includes(c.code);
        return `<div class="country-option${selected ? ' is-selected' : ''}" data-code="${escapeHtml(c.code)}">
            <span class="country-check">${selected ? '&check;' : ''}</span>${escapeHtml(c.name)}
        </div>`;
    }).join('');
    countryOptionsEl.querySelectorAll('.country-option[data-code]').forEach((el) =>
        el.addEventListener('mousedown', (e) => { e.preventDefault(); toggleCountry(el.dataset.code); }));
}

function toggleCountry(code) {
    if (!state.editable) return;
    const i = state.targetCountries.indexOf(code);
    if (i >= 0) state.targetCountries.splice(i, 1);
    else state.targetCountries.push(code);
    renderCountryChips();
    if (countryOptionsEl.style.display !== 'none') renderCountryOptions();
}

function showCountryOptions() {
    if (!state.editable) return;
    renderCountryOptions();
    countryOptionsEl.style.display = 'block';
}

function hideCountryOptions() {
    countryOptionsEl.style.display = 'none';
}

countrySearchEl.addEventListener('focus', showCountryOptions);
countrySearchEl.addEventListener('input', renderCountryOptions);
countrySearchEl.addEventListener('blur', () => setTimeout(hideCountryOptions, 120));

// ── Per-field show/hide toggles ───────────────────────────────
// Company name / headline / body are optional. Hiding one omits it from the
// preview (no placeholder) and saves it empty, so the preview matches the
// published ad. The typed value stays in the (dimmed) input in case they toggle
// it back on before saving.

const FIELD_INPUTS = { companyName: companyEl, title: titleEl, body: bodyEl };
const FIELD_NAMES = { companyName: 'company name', title: 'headline', body: 'body' };

function applyFieldToggle(field) {
    const hidden = state.fieldHidden[field];
    const input = FIELD_INPUTS[field];
    const btn = document.querySelector(`.field-toggle[data-field="${field}"]`);
    if (btn) {
        btn.innerHTML = hidden ? EYE_OFF_ICON : EYE_ICON;
        btn.classList.toggle('is-off', hidden);
        btn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
        btn.title = hidden ? 'Show in preview' : 'Hide in preview';
        btn.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} ${FIELD_NAMES[field]} in preview`);
    }
    if (input) {
        input.classList.toggle('field-input-hidden', hidden);
        input.disabled = hidden;
    }
}

function toggleField(field) {
    if (!state.editable) return;
    state.fieldHidden[field] = !state.fieldHidden[field];
    applyFieldToggle(field);
    updatePreview();
}

// Value for a creative field, honoring its hide toggle (hidden => saved empty).
function fieldValue(field, el) {
    return state.fieldHidden[field] ? '' : el.value.trim();
}

document.querySelectorAll('.field-toggle').forEach((btn) =>
    btn.addEventListener('click', () => toggleField(btn.dataset.field)));

function updatePreview() {
    renderPreview(previewTarget, {
        companyName: companyEl.value,
        title: titleEl.value,
        body: bodyEl.value,
        url: urlEl.value,
        hiddenCompany: state.fieldHidden.companyName,
        hiddenTitle: state.fieldHidden.title,
        hiddenBody: state.fieldHidden.body,
        imageUrl: state.selectedImageFile ? URL.createObjectURL(state.selectedImageFile) : (state.adDoc?.imageUrl || ''),
        videoUrl: state.selectedVideoFile ? URL.createObjectURL(state.selectedVideoFile) : (state.removeVideo ? '' : (state.adDoc?.videoUrl || '')),
    });
}

companyEl.addEventListener('input', updatePreview);
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

// Reads a video file's duration by loading its metadata. Resolves seconds, or
// rejects if the browser can't decode it (wrong codec / not really an MP4).
function readVideoDuration(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(probe.duration); };
        probe.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
        probe.src = url;
    });
}

// Validates format, size, and duration. Returns an error message string, or ''
// when the file is acceptable.
async function validateVideoFile(file) {
    if (file.type !== 'video/mp4') {
        return 'Please use an MP4 (H.264) video.';
    }
    if (file.size >= MAX_VIDEO_BYTES) {
        return `Video must be under 25 MB (selected ${(file.size / 1048576).toFixed(1)} MB).`;
    }
    let duration;
    try {
        duration = await readVideoDuration(file);
    } catch (_) {
        return "Couldn't read that video. Please use an MP4 (H.264) file.";
    }
    if (duration > MAX_VIDEO_SECONDS + 0.5) {
        return `Video must be ${MAX_VIDEO_SECONDS} seconds or less (selected ${duration.toFixed(0)}s).`;
    }
    return '';
}

videoEl.addEventListener('change', async (e) => {
    const file = e.target.files[0] || null;
    if (!file) {
        state.selectedVideoFile = null;
        updateVideoStatus();
        updatePreview();
        return;
    }
    const error = await validateVideoFile(file);
    if (error) {
        showResult(error, 'danger');
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
    const companyName = fieldValue('companyName', companyEl);
    const title = fieldValue('title', titleEl);
    const body = fieldValue('body', bodyEl);
    const url = urlEl.value.trim();
    if (!state.adId && !state.selectedImageFile) {
        showResult('Add an image before saving.', 'danger');
        return false;
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
            // internalPreview must be explicitly false — the Flutter feed query uses
            // .where(internalPreview, isEqualTo: false), which misses docs where the
            // field is absent.
            // previewUserIds includes the owner's uid so they can be added to an
            // internal-preview run by the admin (paired with internalPreview=true)
            // and see their own ad in-app before it's fully public.
            await setDoc(doc(db, 'ads', id), {
                id,
                ownerId: state.user.uid,
                status: 'draft',
                active: false,
                internalPreview: false,
                previewUserIds: [state.user.uid],
                companyName,
                title,
                body,
                url,
                imageUrl,
                videoUrl,
                targetCountries: state.targetCountries,
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
                companyName,
                title,
                body,
                url,
                imageUrl,
                videoUrl,
                targetCountries: state.targetCountries,
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
        updateStatusBanner();
        updateButtonVisibility();
        updateStatsPanel();
        showResult('Saved.', 'success');
        return true;
    } catch (e) {
        showResult(`Error saving: ${e.message}`, 'danger');
        return false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save draft';
    }
}

document.getElementById('save-draft-btn').addEventListener('click', saveDraft);
