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
const impressionsForCents = (cents) => Math.floor((cents * 1000) / CPM_CENTS);
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
    onSnapshot,
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
    mode: 'wizard', // 'wizard' (create/edit draft) | 'detail' (funded ad)
    step: 1, // wizard step 1-3
    balanceCents: 0,
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

let resultTimer = null;
function showResult(msg, kind) {
    resultEl.className = `alert alert-${kind}`;
    resultEl.textContent = msg;
    resultEl.classList.remove('d-none');
    // Ensure the message is on screen — it sits at the top of the form, so a tap
    // on a button lower down would otherwise leave it out of view.
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; }
    // Errors stay put so they can actually be read; they clear on the next action.
    // Other messages fade on their own.
    if (kind !== 'danger') resultTimer = setTimeout(() => resultEl.classList.add('d-none'), 4000);
}

function hideResult() {
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; }
    resultEl.classList.add('d-none');
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
    watchBalance(user.uid);
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
    // Capture the last step before populateForm resets it, so we can resume there.
    const savedStep = state.adId ? parseInt(localStorage.getItem(`sqAdStep:${state.adId}`), 10) : 1;
    populateForm();
    updatePreview();
    renderActivityLog();
    renderAdGraph();
    resumeWizardStep(savedStep).then(handleFundedReturn);
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
    const hide = ['stop-edit-btn', 'topup-btn', 'delete-btn', 'ad-video-remove'];
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
    const savedHidden = Array.isArray(state.adDoc?.hiddenFields) ? state.adDoc.hiddenFields : [];
    savedHidden.forEach((k) => { if (k in state.fieldHidden) state.fieldHidden[k] = true; });
    ['companyName', 'title', 'body'].forEach(applyFieldToggle);
    renderCountryChips();
    syncAudienceScope();
    // Restore the spend limit saved on the ad doc so the budget step comes back
    // filled in (and Continue enabled) after a reload or an add-funds redirect.
    const draftBudgetCents = Number(state.adDoc?.draftBudgetCents) || 0;
    if (draftBudgetCents >= 1000) {
        document.getElementById('fund-budget').value = String(Math.floor(draftBudgetCents / 100));
    }
    state.step = 1;
    updateStatusBanner();
    renderEditor();
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
        text = `Approved — live${start && end ? ` from ${start} to ${end}` : ''}.`;
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

// True once an ad has a paid budget (set at funding, before approval).
function everFunded() {
    return !!(state.adDoc && Number(state.adDoc.budgetCents) > 0);
}

// Chooses the creation wizard vs the tabbed editor and renders it. The wizard is
// only for a brand-new ad still being built (a fresh draft that hasn't been
// submitted or funded). A submitted/approved/completed/rejected ad — or a funded
// draft stopped for editing — opens the tabbed editor.
function renderEditor() {
    const s = state.adDoc ? status() : 'new';
    const wizard = (s === 'new' || s === 'draft') && !everFunded();
    state.mode = wizard ? 'wizard' : 'tabs';

    document.getElementById('wizard-header').style.display = wizard ? 'block' : 'none';
    document.getElementById('wizard-nav').style.display = wizard ? 'flex' : 'none';
    document.getElementById('editor-tabs').style.display = wizard ? 'none' : 'flex';
    document.getElementById('editor-title').style.display = 'none';

    // The wizard header carries its own copy, so hide the status banner there
    // except to surface a rejection reason. Tabs always show the banner.
    const banner = document.getElementById('status-banner');
    if (wizard && s !== 'rejected') banner.style.display = 'none';

    if (wizard) {
        ['perf-budget', 'stats-panel', 'graph-panel', 'activity-log'].forEach((id) => { document.getElementById(id).style.display = 'none'; });
        goToStep(state.step || 1);
    } else {
        renderTabs();
    }
    updateStatsPanel();
}

// ── Tabbed editor (funded ad) ─────────────────────────────────

const TAB_STEP = { creative: '1', audience: '2', schedule: '4' };

function renderTabs() {
    document.getElementById('evaluating').style.display = 'none';
    document.getElementById('editor-grid').style.display = '';
    updateStatusBanner();
    fillBudgetFigures();
    if (!state.tabsWired) {
        document.querySelectorAll('#editor-tabs .etab').forEach((btn) =>
            btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
        state.tabsWired = true;
    }
    // Admin preview is read-only; otherwise the creative/audience/budget/schedule
    // fields are editable (a creative save routes through stop + re-review).
    setEditorReadOnly(!!state.isAdminPreview);
    prefillScheduleFromDoc();
    const s = status();
    // Land on Performance for a running/finished ad; on Creative when the ad needs
    // attention (rejected) or was stopped to be edited (draft).
    const initial = state.activeTab || (s === 'rejected' || s === 'draft' ? 'creative' : 'performance');
    setActiveTab(initial);
}

function setActiveTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('#editor-tabs .etab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const grid = document.getElementById('editor-grid');
    grid.classList.remove('only-form', 'only-preview', 'single');
    document.querySelectorAll('.wizard-step').forEach((el) => { el.style.display = 'none'; });
    ['creative-actions', 'audience-actions', 'schedule-actions'].forEach((id) => { document.getElementById(id).style.display = 'none'; });
    ['ad-preview-card', 'perf-budget', 'stats-panel', 'graph-panel', 'activity-log'].forEach((id) => { document.getElementById(id).style.display = 'none'; });
    document.querySelector('.editor-preview').style.display = '';
    hideResult();

    if (tab === 'performance') {
        grid.classList.add('only-preview');
        document.getElementById('perf-budget').style.display = everFunded() ? 'block' : 'none';
        document.getElementById('stats-panel').style.display = 'block';
        updateStatsPanel();
        // These manage their own visibility from the data they load.
        renderAdGraph();
        renderActivityLog();
    } else if (tab === 'creative') {
        document.querySelector('.wizard-step[data-step="1"]').style.display = 'block';
        document.getElementById('ad-preview-card').style.display = '';
        document.getElementById('creative-actions').style.display = 'block';
        renderCreativeActions();
    } else if (tab === 'audience') {
        grid.classList.add('only-form');
        document.querySelector('.wizard-step[data-step="2"]').style.display = 'block';
        document.getElementById('audience-actions').style.display = state.isAdminPreview ? 'none' : 'flex';
    } else if (tab === 'budget') {
        grid.classList.add('only-form');
        document.getElementById('budget-tab').style.display = 'block';
        renderBudgetTab();
    } else if (tab === 'schedule') {
        grid.classList.add('only-form');
        document.querySelector('.wizard-step[data-step="4"]').style.display = 'block';
        document.getElementById('schedule-actions').style.display = state.isAdminPreview ? 'none' : 'flex';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCreativeActions() {
    const warn = document.getElementById('creative-warning');
    const s = status();
    const live = s === 'approved' || s === 'pending' || s === 'completed';
    warn.style.display = live ? 'block' : 'none';
    if (live) {
        warn.textContent = "Saving creative changes stops this ad and sends it back for review. It won't run again until it's re-approved.";
    }
    document.getElementById('creative-actions').style.display = state.isAdminPreview ? 'none' : 'block';
}

function setStepper(step) {
    document.querySelectorAll('.wstep').forEach((el) => {
        const n = Number(el.dataset.s);
        el.classList.toggle('done', n < step);
        el.classList.toggle('active', n === step);
    });
}

function goToStep(step) {
    state.step = step;
    if (state.adId) localStorage.setItem(`sqAdStep:${state.adId}`, String(step));
    setEditorReadOnly(false);
    document.getElementById('evaluating').style.display = 'none';
    document.getElementById('editor-grid').style.display = '';
    setStepper(step);
    document.querySelectorAll('.wizard-step').forEach((el) => {
        el.style.display = (Number(el.dataset.step) === step) ? 'block' : 'none';
    });
    // Preview lives on step 1 only; later steps go full width.
    const grid = document.getElementById('editor-grid');
    document.querySelector('.editor-preview').style.display = step === 1 ? '' : 'none';
    grid.classList.toggle('single', step !== 1);

    const secondary = document.getElementById('wiz-secondary');
    const next = document.getElementById('wiz-next');
    hideResult();
    next.disabled = false;
    next.dataset.act = 'pay';
    const alreadyFunded = !!(state.adDoc && Number(state.adDoc.budgetCents) > 0);
    if (step === 1) {
        secondary.textContent = 'Save draft'; secondary.dataset.act = 'save';
        next.textContent = 'Check & continue';
    } else if (step === 2) {
        secondary.textContent = '← Back'; secondary.dataset.act = 'back';
        next.textContent = 'Continue';
    } else if (step === 3) {
        // Budget: set the spend limit and (if short) load funds. The button text
        // and action are decided by updatePaySummary once the balance loads.
        secondary.textContent = '← Back'; secondary.dataset.act = 'back';
        next.textContent = 'Continue';
        next.disabled = true;
        // The spend limit is restored from the ad doc in populateForm, so it's
        // already in the field here (survives reloads and the add-funds trip).
        updateFundImpressions();
        updatePaySummary();
    } else {
        // Step 4: schedule, then the final submit (funds already come from the balance).
        secondary.textContent = '← Back'; secondary.dataset.act = 'back';
        next.dataset.act = 'pay';
        next.textContent = alreadyFunded ? 'Resubmit for review' : 'Submit for review';
        updateSchedulePaynote();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Same fingerprint the server (adModerationContentHash) computes, so we can tell
// whether the AI's approval still applies to the current creative.
async function adCreativeHash(ad) {
    const payload = JSON.stringify({
        title: ad.title || '',
        body: ad.body || '',
        url: ad.url || '',
        companyName: ad.companyName || '',
        imageUrl: ad.imageUrl || '',
    });
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// On refresh, resume the step the advertiser left off on — but only if the AI has
// already cleared the CURRENT creative. If they changed the creative since (hash
// mismatch) or it was rejected, they go back to step 1 to re-check.
async function resumeWizardStep(savedStep) {
    if (state.mode !== 'wizard' || !state.adId || !state.adDoc) return;
    if (!(savedStep >= 2 && savedStep <= 4)) return;
    const m = state.adDoc.aiModeration;
    const approved = m && m.verdict !== 'reject' && state.adDoc.aiModeratedHash
        && state.adDoc.aiModeratedHash === (await adCreativeHash(state.adDoc));
    if (approved) goToStep(savedStep);
}

function readPending() {
    const raw = state.adId ? localStorage.getItem(`sqAdPending:${state.adId}`) : null;
    try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}

// Called on every load. After a Stripe shortfall payment the webhook credits the
// wallet AND applies the fund/top-up server-side, so we just watch the payment
// record until it's done — which works whether we're coming straight back from
// Stripe (?funded=1) or refreshed later while it was still processing.
async function handleFundedReturn() {
    const params = new URLSearchParams(window.location.search);
    const wasFundedReturn = params.get('funded') === '1';
    if (wasFundedReturn) {
        params.delete('funded');
        const qs = params.toString();
        window.history.replaceState(null, '', `/advertise/ad.html${qs ? `?${qs}` : ''}`);
    }
    const pending = readPending();
    if (!pending) { if (wasFundedReturn) showResult('Payment received.', 'success'); return; }
    if (pending.paymentId) {
        watchPaymentApplied(pending);
    } else if (wasFundedReturn) {
        // Legacy pending from before server-side apply existed: finish it client-side.
        legacyResumePendingPayment(pending);
    }
}

// Watches the wallet transaction until the webhook marks it paid (which happens
// only after the credit + fund/top-up are committed together). No client re-apply,
// so there's no race and no double-charge.
function watchPaymentApplied(pending) {
    showResult('Finishing up your payment…', 'info');
    let done = false;
    const finish = (fn) => { if (done) return; done = true; try { unsub(); } catch (_) { /* already off */ } fn(); };
    const unsub = onSnapshot(doc(db, 'advertisers', state.user.uid, 'walletTx', pending.paymentId), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        if (d.status !== 'paid') return;
        finish(() => {
            localStorage.removeItem(`sqAdPending:${state.adId}`);
            localStorage.removeItem(`sqAdStep:${state.adId}`);
            if (d.intentApplied === false) {
                showResult("Your payment landed as wallet credit, but we couldn't finish setting up the ad. Open the Budget tab and try again — it'll use your credit.", 'danger');
                return;
            }
            if (pending.type === 'topup') {
                showResult('Budget increased. Your ad keeps running.', 'success');
                setTimeout(() => window.location.reload(), 1000);
            } else {
                showResult("Submitted for review. We'll email you when it's approved.", 'success');
                setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 1000);
            }
        });
    }, () => { /* permission/offline: the timeout below covers it */ });
    // If the webhook is unusually slow, stop waiting. We leave the pending in place
    // so a refresh re-attaches this watcher and finishes the job.
    setTimeout(() => finish(() => {
        showResult('Your payment is taking a moment to finish. Refresh in a few seconds.', 'info');
    }), 60000);
}

// Fallback for a pending stashed before the checkout carried a server-side intent
// (no paymentId): apply it from the client, retrying while the credit lands.
async function legacyResumePendingPayment(pending) {
    showResult('Finishing up your payment…', 'info');
    const run = () => (pending.type === 'topup'
        ? httpsCallable(functions, 'topUpAd')({ adId: state.adId, addCents: pending.addCents, newEndDateMillis: pending.newEndDateMillis || 0 })
        : httpsCallable(functions, 'fundAd')({ adId: state.adId, budgetCents: pending.budgetCents, startDateMillis: pending.startDateMillis || 0, endDateMillis: pending.endDateMillis || 0 }));
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            await run();
            localStorage.removeItem(`sqAdPending:${state.adId}`);
            localStorage.removeItem(`sqAdStep:${state.adId}`);
            if (pending.type === 'topup') {
                showResult('Budget increased. Your ad keeps running.', 'success');
                setTimeout(() => window.location.reload(), 1000);
            } else {
                showResult("Submitted for review. We'll email you when it's approved.", 'success');
                setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 1000);
            }
            return;
        } catch (e) {
            if (e.message === 'INSUFFICIENT_BALANCE' && attempt < 7) {
                await new Promise((r) => setTimeout(r, 2000));
                continue;
            }
            localStorage.removeItem(`sqAdPending:${state.adId}`);
            showResult(e.message === 'INSUFFICIENT_BALANCE'
                ? 'Your payment is still clearing. Refresh in a few seconds to finish.'
                : (e.message || 'Could not finish applying your payment.'), 'danger');
            return;
        }
    }
}

// Sends the advertiser to Stripe to pay a shortfall, rounded up to the whole
// dollar (leaves at most a few cents of credit, above Stripe's $0.50 floor). The
// intent rides along so the webhook applies the money to the ad server-side; the
// returned paymentId is stashed so the return can watch it complete.
async function redirectToShortfallCheckout(shortfallCents, intent) {
    const amountCents = Math.max(50, Math.ceil(shortfallCents / 100) * 100);
    const res = await httpsCallable(functions, 'createAdFundsCheckout')({
        amountCents,
        adId: state.adId,
        intent,
        testMode: localStorage.getItem('sqAdTestMode') === '1',
    });
    const url = res.data && res.data.url;
    if (!url) throw new Error('No checkout URL returned.');
    const paymentId = res.data && res.data.paymentId;
    if (paymentId) {
        const pending = readPending() || {};
        pending.paymentId = paymentId;
        localStorage.setItem(`sqAdPending:${state.adId}`, JSON.stringify(pending));
    }
    window.location.href = url;
}

// Live wallet balance via a Firestore stream: the moment the webhook writes the
// new balanceCents, the budget/schedule step re-renders (no polling).
let balanceUnsub = null;
function watchBalance(uid) {
    if (balanceUnsub) return;
    balanceUnsub = onSnapshot(doc(db, 'advertisers', uid), (snap) => {
        state.balanceCents = snap.exists() ? (Number(snap.data().balanceCents) || 0) : 0;
        if (state.mode === 'tabs') {
            if (state.activeTab === 'budget') updateBudgetIncrease();
            return;
        }
        if (state.mode !== 'wizard') return;
        if (state.step === 3) updatePaySummary();
        else if (state.step === 4) updateSchedulePaynote();
    }, () => { /* permission/offline: leave last-known balance */ });
}

// Fills the performance numbers. Visibility is owned by the tab engine in tabs
// mode; in the wizard the panel stays hidden (there's nothing to show yet).
function updateStatsPanel() {
    const panel = document.getElementById('stats-panel');
    if (everFunded()) {
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
    }
    if (state.mode !== 'tabs') panel.style.display = 'none';
}

// Fills the budget total / remaining / progress bar in both the Budget tab and
// the compact summary on the Performance tab.
function fillBudgetFigures() {
    if (!everFunded()) return;
    const budget = Number(state.adDoc.budgetCents) || 0;
    const spent = Math.min(budget, Number(state.adDoc.spentCents) || 0);
    const remaining = Math.max(0, budget - spent);
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const note = `${formatMoney(spent)} spent of ${formatMoney(budget)} · buys ≈ ${impressionsForCents(budget).toLocaleString()} impressions`;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('budget-total', formatMoney(budget));
    set('budget-remaining', formatMoney(remaining));
    set('budget-spent-note', note);
    set('perf-budget-total', formatMoney(budget));
    set('perf-budget-remaining', formatMoney(remaining));
    set('perf-budget-note', note);
    const fillTab = document.getElementById('budget-bar-fill');
    const fillPerf = document.getElementById('perf-budget-fill');
    if (fillTab) fillTab.style.width = `${pct}%`;
    if (fillPerf) fillPerf.style.width = `${pct}%`;
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
    if (state.mode === 'wizard') { panel.style.display = 'none'; return; }
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
    if (state.mode === 'wizard') { panel.style.display = 'none'; return; }
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
        fillBudgetFigures();
    }
});

// ── Wizard navigation ─────────────────────────────────────────
function wizNext() {
    hideResult(); // clear any lingering error from the previous attempt
    if (state.step === 1) return checkAndContinue();
    if (state.step === 2) return audienceContinue();
    // Step 3 (budget): just record the amount and move on — payment happens at the
    // final submit, where any available credit is applied and only the gap is charged.
    if (state.step === 3) return budgetContinue();
    // Step 4 (schedule): the final submit.
    return payAndSubmit();
}

function wizSecondary() {
    if (document.getElementById('wiz-secondary').dataset.act === 'back') {
        goToStep(state.step - 1);
        return;
    }
    saveDraftFromWizard();
}

async function saveDraftFromWizard() {
    if (!state.adId && !state.selectedImageFile) {
        showResult('Add an image before saving.', 'danger');
        return;
    }
    const ok = await saveDraft();
    if (ok) showResult('Saved. You can finish this later from your portal.', 'success');
}

function showEvaluating() {
    document.getElementById('editor-grid').style.display = 'none';
    document.getElementById('wizard-nav').style.display = 'none';
    document.getElementById('evaluating').style.display = 'flex';
}

function hideEvaluating() {
    document.getElementById('evaluating').style.display = 'none';
    document.getElementById('editor-grid').style.display = '';
    document.getElementById('wizard-nav').style.display = 'flex';
}

// Step 1 → save the creative draft, run the AI check, then advance (or show why not).
async function checkAndContinue() {
    if (!urlEl.value.trim()) { showResult('Add a click-through URL before continuing.', 'danger'); return; }
    if (!state.adId && !state.selectedImageFile) { showResult('Add an image before continuing.', 'danger'); return; }
    const saved = await saveDraft();
    if (!saved) return;
    if (!state.adDoc.imageUrl) { showResult('Add an image before continuing.', 'danger'); return; }
    showEvaluating();
    try {
        const res = await httpsCallable(functions, 'moderateAdSubmission')({ adId: state.adId });
        hideEvaluating();
        if (res.data && res.data.verdict === 'reject') {
            const reasons = (res.data.reasons || []).join(' ') || "It doesn't meet our advertising guidelines.";
            goToStep(1);
            showResult(`Not approved: ${reasons}`, 'danger');
            return;
        }
        goToStep(2);
    } catch (e) {
        hideEvaluating();
        goToStep(1);
        showResult(`Could not check your ad: ${e.message}`, 'danger');
    }
}

// Step 2 → save the audience, advance to budget.
async function audienceContinue() {
    const scope = document.querySelector('input[name="audience-scope"]:checked');
    if (scope && scope.value === 'specific' && state.targetCountries.length === 0) {
        showResult('Add at least one country, or choose Everywhere.', 'danger');
        return;
    }
    try {
        await updateDoc(doc(db, 'ads', state.adId), {
            targetCountries: state.targetCountries,
            lastUpdatedAt: serverTimestamp(),
        });
        const snap = await getDoc(doc(db, 'ads', state.adId));
        state.adDoc = snap.data();
    } catch (e) {
        showResult(`Could not save: ${e.message}`, 'danger');
        return;
    }
    goToStep(3);
}

// Step 4 → fund from balance (or re-commit an already-funded ad) and submit.
async function payAndSubmit() {
    hideResult();
    const next = document.getElementById('wiz-next');
    const alreadyFunded = !!(state.adDoc && Number(state.adDoc.budgetCents) > 0);
    let budgetCents = 0; let startDateMillis = 0; let endDateMillis = 0;
    if (!alreadyFunded) {
        const dollars = Math.floor(Number(document.getElementById('fund-budget').value));
        if (!Number.isFinite(dollars) || dollars < 10) { fundingError('Enter a spend limit of at least $10.'); return; }
        budgetCents = dollars * 100;
        const startCustom = document.querySelector('input[name="start-mode"]:checked')?.value === 'custom';
        const endCustom = document.querySelector('input[name="end-mode"]:checked')?.value === 'custom';
        const startVal = document.getElementById('fund-start').value;
        const endVal = document.getElementById('fund-end').value;
        if (startCustom && !startVal) { fundingError('Pick a start date, or choose "As soon as approved".'); return; }
        if (endCustom && !endVal) { fundingError('Pick an end date, or choose "When the budget is spent".'); return; }
        startDateMillis = startVal ? Date.parse(`${startVal}T00:00:00`) : 0;
        endDateMillis = endVal ? Date.parse(`${endVal}T23:59:59`) : 0;
        if (startDateMillis && endDateMillis && endDateMillis < startDateMillis) { fundingError('End date must be after the start date.'); return; }
    }
    const label = next.textContent;
    next.disabled = true;
    next.textContent = 'Submitting…';
    try {
        if (alreadyFunded) {
            await httpsCallable(functions, 'resubmitAd')({ adId: state.adId });
        } else {
            await httpsCallable(functions, 'fundAd')({ adId: state.adId, budgetCents, startDateMillis, endDateMillis });
        }
        localStorage.removeItem(`sqAdStep:${state.adId}`);
        localStorage.removeItem(`sqAdPending:${state.adId}`);
        showResult("Submitted for review. We'll email you when it's approved.", 'success');
        setTimeout(() => { window.location.href = '/advertise/portal.html'; }, 900);
    } catch (e) {
        if (e.message === 'INSUFFICIENT_BALANCE') {
            // Available credit doesn't cover it: stash the submit, pay the exact
            // shortfall, and apply it automatically on return.
            const shortfall = (e.details && e.details.shortfallCents) || budgetCents;
            localStorage.setItem(`sqAdPending:${state.adId}`, JSON.stringify({ type: 'fund', budgetCents, startDateMillis, endDateMillis }));
            next.textContent = 'Opening secure checkout…';
            try {
                await redirectToShortfallCheckout(shortfall, { kind: 'fund', adId: state.adId, budgetCents, startDateMillis, endDateMillis });
            } catch (e2) {
                next.disabled = false;
                next.textContent = label;
                fundingError(e2.message || 'Could not start checkout.');
            }
        } else {
            next.disabled = false;
            next.textContent = label;
            fundingError(e.message || 'Could not submit.');
        }
    }
}

document.getElementById('wiz-next').addEventListener('click', wizNext);
document.getElementById('wiz-secondary').addEventListener('click', wizSecondary);

// Coming back from Stripe via the browser Back button restores this page from the
// back-forward cache with the button frozen at "Opening secure checkout…" (the
// script never re-runs). Re-render the current step so the button resets.
window.addEventListener('pageshow', (e) => {
    if (!e.persisted || editorEl.style.display === 'none') return;
    if (state.mode === 'wizard') goToStep(state.step);
    else if (state.mode === 'tabs') setActiveTab(state.activeTab || 'performance');
});

// Sysadmin-only Stripe test-mode toggle on the budget step, sharing the same
// localStorage flag the portal's add-funds panel uses.
(function initAdTestMode() {
    const check = document.getElementById('ad-test-mode-check');
    if (!check) return;
    check.checked = localStorage.getItem('sqAdTestMode') === '1';
    check.addEventListener('change', () => localStorage.setItem('sqAdTestMode', check.checked ? '1' : '0'));
    httpsCallable(functions, 'verifySysAdmin')().then((r) => {
        if (r.data && r.data.isSysAdmin) document.getElementById('ad-test-mode-row').classList.remove('d-none');
    }).catch(() => { /* not a sysadmin / offline: leave hidden */ });
})();

// ── Tab saves (Creative / Audience / Schedule) ────────────────

// Sets the Schedule tab's toggles + date inputs from the saved ad so an existing
// custom start/end shows as "On a date", not the default "as soon as approved".
function prefillScheduleFromDoc() {
    const start = state.adDoc?.startDate?.toDate ? state.adDoc.startDate.toDate() : null;
    const end = state.adDoc?.endDate?.toDate ? state.adDoc.endDate.toDate() : null;
    const toInput = (d) => (d ? d.toISOString().slice(0, 10) : '');
    const setMode = (which, custom, val) => {
        document.querySelector(`input[name="${which}-mode"][value="${custom ? 'custom' : 'auto'}"]`).checked = true;
        document.getElementById(`${which}-date-wrap`).style.display = custom ? 'block' : 'none';
        document.getElementById(which === 'start' ? 'fund-start' : 'fund-end').value = custom ? val : '';
    };
    setMode('start', !!start, toInput(start));
    setMode('end', !!end, toInput(end));
}

// Creative changes are the only edit that needs re-review. On a live/pending/
// completed ad we stop it first (which the rules require before creative can be
// written), save, re-run the automated check, then resubmit for approval.
async function saveCreativeTab() {
    if (!urlEl.value.trim()) { showResult('Add a click-through URL before saving.', 'danger'); return; }
    const s = status();
    const mustStop = s === 'approved' || s === 'pending' || s === 'completed';
    if (mustStop && !confirm("Save creative changes? This stops the ad and sends it back for review — it won't run again until it's re-approved.")) return;
    const btn = document.getElementById('save-creative-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        if (mustStop) {
            await httpsCallable(functions, 'stopAd')({ adId: state.adId });
            state.adDoc.status = 'draft';
        }
        const ok = await saveDraft();
        if (!ok) { btn.disabled = false; btn.textContent = 'Save creative changes'; return; }
        const res = await httpsCallable(functions, 'moderateAdSubmission')({ adId: state.adId });
        if (res.data && res.data.verdict === 'reject') {
            const reasons = (res.data.reasons || []).join(' ') || "It doesn't meet our advertising guidelines.";
            showResult(`Not approved: ${reasons}`, 'danger');
            renderCreativeActions();
            btn.disabled = false;
            btn.textContent = 'Save creative changes';
            return;
        }
        await httpsCallable(functions, 'resubmitAd')({ adId: state.adId });
        showResult("Saved. Your changes are back in review — we'll email you when they're approved.", 'success');
        setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
        showResult(e.message || 'Could not save your changes.', 'danger');
        btn.disabled = false;
        btn.textContent = 'Save creative changes';
    }
}

// Audience applies live — targeting isn't part of the moderated creative.
async function saveAudienceTab() {
    const scope = document.querySelector('input[name="audience-scope"]:checked');
    if (scope && scope.value === 'specific' && state.targetCountries.length === 0) {
        showResult('Add at least one country, or choose Everywhere.', 'danger');
        return;
    }
    const btn = document.getElementById('save-audience-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await httpsCallable(functions, 'updateAdSettings')({ adId: state.adId, targetCountries: state.targetCountries });
        state.adDoc.targetCountries = [...state.targetCountries];
        showResult('Audience updated.', 'success');
    } catch (e) {
        showResult(e.message || 'Could not save the audience.', 'danger');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save audience';
    }
}

// Schedule applies live too.
async function saveScheduleTab() {
    const startCustom = document.querySelector('input[name="start-mode"]:checked')?.value === 'custom';
    const endCustom = document.querySelector('input[name="end-mode"]:checked')?.value === 'custom';
    const startVal = document.getElementById('fund-start').value;
    const endVal = document.getElementById('fund-end').value;
    if (startCustom && !startVal) { showResult('Pick a start date, or choose "As soon as approved".', 'danger'); return; }
    if (endCustom && !endVal) { showResult('Pick an end date, or choose "When the budget is spent".', 'danger'); return; }
    const startDateMillis = startCustom && startVal ? Date.parse(`${startVal}T00:00:00`) : 0;
    const endDateMillis = endCustom && endVal ? Date.parse(`${endVal}T23:59:59`) : 0;
    if (startDateMillis && endDateMillis && endDateMillis < startDateMillis) { showResult('End date must be after the start date.', 'danger'); return; }
    const btn = document.getElementById('save-schedule-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await httpsCallable(functions, 'updateAdSettings')({ adId: state.adId, startDateMillis, endDateMillis });
        showResult('Schedule updated.', 'success');
    } catch (e) {
        showResult(e.message || 'Could not save the schedule.', 'danger');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save schedule';
    }
}

document.getElementById('save-creative-btn').addEventListener('click', saveCreativeTab);
document.getElementById('creative-discard-btn').addEventListener('click', () => window.location.reload());
document.getElementById('save-audience-btn').addEventListener('click', saveAudienceTab);
document.getElementById('audience-discard-btn').addEventListener('click', () => window.location.reload());
document.getElementById('save-schedule-btn').addEventListener('click', saveScheduleTab);
document.getElementById('schedule-discard-btn').addEventListener('click', () => window.location.reload());

// ── Budget tab (increase an existing ad's total) ──────────────

// What raising the total to the entered amount costs: draw from any unallocated
// wallet credit first, then charge the remainder rounded up to a whole dollar
// (matching redirectToShortfallCheckout). available = balance − committed, where
// committed mirrors the server's sum of unspent budget across the owner's live ads.
function budgetIncreaseQuote() {
    const budget = Number(state.adDoc?.budgetCents) || 0;
    const newTotalCents = (Math.floor(Number(document.getElementById('budget-new-total').value)) || 0) * 100;
    const addCents = newTotalCents - budget;
    const available = Math.max(0, (Number(state.balanceCents) || 0) - (Number(state.committedCents) || 0));
    const rawCost = Math.max(0, addCents - available);
    const chargeCents = rawCost > 0 ? Math.max(50, Math.ceil(rawCost / 100) * 100) : 0;
    return { budget, newTotalCents, addCents, available, chargeCents };
}

function updateBudgetIncrease() {
    const q = budgetIncreaseQuote();
    const imprEl = document.getElementById('budget-increase-impressions');
    const btn = document.getElementById('budget-increase-btn');
    if (q.addCents <= 0) {
        imprEl.textContent = `Enter a total above ${formatMoney(q.budget)}.`;
        btn.textContent = 'Increase budget';
        return;
    }
    const costNote = q.chargeCents === 0
        ? 'Covered by your available credit — no charge.'
        : `You'll pay ${formatMoney(q.chargeCents)}.`;
    imprEl.textContent = `New total buys ≈ ${impressionsForCents(q.newTotalCents).toLocaleString()} impressions. ${costNote}`;
    btn.textContent = `Increase budget · ${formatMoney(q.chargeCents)}`;
}

// Loads the owner's committed budget so the charge quote is accurate; re-renders
// the quote once known.
async function refreshCommitted() {
    if (!state.user) return;
    try {
        const snap = await getDocs(query(collection(db, 'ads'), where('ownerId', '==', state.user.uid)));
        let c = 0;
        snap.forEach((d) => {
            const a = d.data();
            if (a.status === 'pending' || a.status === 'approved') {
                c += Math.max(0, (Number(a.budgetCents) || 0) - (Number(a.spentCents) || 0));
            }
        });
        state.committedCents = c;
    } catch (_) { /* keep last known */ }
    if (state.activeTab === 'budget') updateBudgetIncrease();
}

function renderBudgetTab() {
    fillBudgetFigures();
    const budget = Number(state.adDoc?.budgetCents) || 0;
    const input = document.getElementById('budget-new-total');
    const budgetDollars = Math.floor(budget / 100);
    if (!input.value || Number(input.value) < budgetDollars) input.value = String(budgetDollars);
    // The budget can only be increased on a running or finished ad (the server's
    // topUpAd guard); for other states, explain when it becomes available.
    const s = status();
    const canIncrease = !state.isAdminPreview && (s === 'approved' || s === 'completed');
    document.getElementById('budget-increase').style.display = canIncrease ? 'block' : 'none';
    const note = document.getElementById('budget-note');
    if (canIncrease) {
        note.style.display = 'none';
        // Budget alone can't restart an ad whose end date already passed — send
        // them to the Schedule tab first.
        const end = state.adDoc?.endDate?.toDate ? state.adDoc.endDate.toDate() : null;
        const endedByDate = end && new Date() > end;
        document.getElementById('budget-increase-sub').textContent = endedByDate
            ? "This ad's end date has passed — update it in the Schedule tab so it can run again, then add budget here."
            : 'Raise the total to keep this ad running longer. It delivers at $15 per 1,000 impressions.';
        updateBudgetIncrease();
        refreshCommitted();
    } else if (!state.isAdminPreview) {
        note.style.display = 'block';
        note.textContent = s === 'pending'
            ? 'You can increase the budget once this ad is approved.'
            : 'You can increase the budget once this ad is running.';
    } else {
        note.style.display = 'none';
    }
}

// Raises the total budget by the difference, drawing from available credit first
// and charging only the shortfall (via the pending-payment resume on return).
async function increaseBudget() {
    const err = document.getElementById('budget-error');
    err.classList.add('d-none');
    const budget = Number(state.adDoc?.budgetCents) || 0;
    const newTotal = Math.floor(Number(document.getElementById('budget-new-total').value));
    if (!Number.isFinite(newTotal) || newTotal * 100 <= budget) {
        err.textContent = `Enter a total higher than ${formatMoney(budget)}.`;
        err.classList.remove('d-none');
        return;
    }
    const addCents = newTotal * 100 - budget;
    const btn = document.getElementById('budget-increase-btn');
    btn.disabled = true;
    btn.textContent = 'Applying…';
    try {
        await httpsCallable(functions, 'topUpAd')({ adId: state.adId, addCents, newEndDateMillis: 0 });
        showResult('Budget increased. Your ad keeps running.', 'success');
        setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
        if (e.message === 'INSUFFICIENT_BALANCE') {
            const shortfall = (e.details && e.details.shortfallCents) || addCents;
            localStorage.setItem(`sqAdPending:${state.adId}`, JSON.stringify({ type: 'topup', addCents }));
            btn.textContent = 'Opening secure checkout…';
            try {
                await redirectToShortfallCheckout(shortfall, { kind: 'topup', adId: state.adId, addCents });
            } catch (e2) {
                err.textContent = e2.message || 'Could not start checkout.';
                err.classList.remove('d-none');
                btn.disabled = false;
                updateBudgetIncrease();
            }
        } else {
            err.textContent = e.message || 'Could not increase the budget.';
            err.classList.remove('d-none');
            btn.disabled = false;
            updateBudgetIncrease();
        }
    }
}

document.getElementById('budget-new-total').addEventListener('input', updateBudgetIncrease);
document.getElementById('budget-increase-btn').addEventListener('click', increaseBudget);

// ── Budget step helpers ───────────────────────────────────────
function fundingError(msg) {
    showResult(msg, 'danger');
}

function updateFundImpressions() {
    const dollars = Math.floor(Number(document.getElementById('fund-budget').value)) || 0;
    document.getElementById('fund-impressions').textContent = dollars >= 10
        ? `≈ ${impressionsForDollars(dollars).toLocaleString()} impressions at $15 per 1,000`
        : '$10 minimum';
}

// Renders the "pays from balance" summary on the budget step. An already-funded ad
// being resubmitted after an edit isn't charged again.
function updatePaySummary() {
    const box = document.getElementById('pay-summary');
    const budgetInput = document.getElementById('fund-budget');
    const next = document.getElementById('wiz-next');
    budgetInput.disabled = false;
    const dollars = Math.floor(Number(budgetInput.value)) || 0;
    const valid = dollars >= 10;
    next.disabled = !valid;
    next.dataset.act = 'continue';
    next.textContent = 'Continue';
    if (!valid) { box.style.display = 'none'; return; }
    const budgetCents = dollars * 100;
    box.style.display = 'block';
    box.innerHTML = `<div class="payrow total"><span>Total budget</span><span>${formatMoney(budgetCents)}</span></div>
        <div class="paynote">You'll confirm and pay on the last step. Any available credit is applied first, so you only pay the difference — and it's spent only as impressions deliver.</div>`;
}

document.getElementById('fund-budget').addEventListener('input', () => {
    updateFundImpressions();
    updatePaySummary();
});
// Persist the spend limit onto the ad doc (on blur/Enter) so it survives a reload
// or the add-funds trip through Stripe. Firestore is the source of truth here —
// populateForm reads it back from state.adDoc.draftBudgetCents.
document.getElementById('fund-budget').addEventListener('change', () => { saveDraftBudget(); });

// Write the current spend limit to the ad doc. No-ops for a not-yet-created ad or
// an already-funded one (its budget is locked). Best-effort: a failed write just
// means the amount isn't restored on the next load, which the user can re-enter.
async function saveDraftBudget() {
    if (!state.adId) return;
    if (state.adDoc && Number(state.adDoc.budgetCents) > 0) return;
    const dollars = Math.floor(Number(document.getElementById('fund-budget').value)) || 0;
    const cents = dollars >= 10 ? dollars * 100 : 0;
    if (Number(state.adDoc?.draftBudgetCents || 0) === cents) return;
    try {
        await updateDoc(doc(db, 'ads', state.adId), { draftBudgetCents: cents, lastUpdatedAt: serverTimestamp() });
        if (state.adDoc) state.adDoc.draftBudgetCents = cents;
    } catch (_) { /* non-fatal: amount just won't be restored next load */ }
}

// Step 3 (budget) → require a valid spend limit, then move to the schedule step.
function budgetContinue() {
    const dollars = Math.floor(Number(document.getElementById('fund-budget').value));
    if (!Number.isFinite(dollars) || dollars < 10) {
        showResult('Enter a spend limit of at least $10.', 'danger');
        return;
    }
    saveDraftBudget();
    goToStep(4);
}

// Confirmation on the schedule step of the total the final submit will charge.
// Available credit is applied first at submit, so this is the ceiling, not
// necessarily the card charge.
function updateSchedulePaynote() {
    const note = document.getElementById('schedule-paynote');
    const dollars = Math.floor(Number(document.getElementById('fund-budget').value)) || 0;
    if (dollars < 10) { note.style.display = 'none'; return; }
    note.style.display = 'block';
    note.innerHTML = `<div class="payrow total"><span>Total budget</span><span>${formatMoney(dollars * 100)}</span></div>
        <div class="paynote">Submitting applies any available credit first and charges only the difference. It's spent only as impressions deliver.</div>`;
}

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

// Everywhere vs Specific-countries choice. Toggling to Everywhere clears the
// list (empty list = worldwide); Specific reveals the picker.
function setAudienceScope(scope) {
    document.getElementById('country-picker-wrap').style.display = scope === 'specific' ? 'block' : 'none';
    if (scope === 'all') {
        state.targetCountries = [];
        renderCountryChips();
    }
}

// Sets the radio + picker visibility from current state, without clearing.
function syncAudienceScope() {
    const scope = state.targetCountries.length > 0 ? 'specific' : 'all';
    const radio = document.querySelector(`input[name="audience-scope"][value="${scope}"]`);
    if (radio) radio.checked = true;
    document.getElementById('country-picker-wrap').style.display = scope === 'specific' ? 'block' : 'none';
}

document.querySelectorAll('input[name="audience-scope"]').forEach((r) =>
    r.addEventListener('change', () => { if (r.checked && state.editable) setAudienceScope(r.value); }));

// Schedule step: start/end each default to automatic (as-soon-as-approved /
// until-budget-spent). "On a date" reveals a date picker; switching back to the
// automatic option hides and clears it so no stray date is submitted.
function setDateMode(which, mode) {
    const inputId = which === 'start' ? 'fund-start' : 'fund-end';
    document.getElementById(`${which}-date-wrap`).style.display = mode === 'custom' ? 'block' : 'none';
    if (mode === 'auto') document.getElementById(inputId).value = '';
}
['start', 'end'].forEach((which) => {
    document.querySelectorAll(`input[name="${which}-mode"]`).forEach((r) =>
        r.addEventListener('change', () => { if (r.checked && state.editable) setDateMode(which, r.value); }));
});

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
    const hiddenFields = Object.keys(state.fieldHidden).filter((k) => state.fieldHidden[k]);
    if (!state.adId && !state.selectedImageFile) {
        showResult('Add an image before saving.', 'danger');
        return false;
    }
    const btn = document.getElementById('wiz-next');
    btn.disabled = true;
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
                hiddenFields,
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
                hiddenFields,
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
        updateStatsPanel();
        return true;
    } catch (e) {
        showResult(`Error saving: ${e.message}`, 'danger');
        return false;
    } finally {
        btn.disabled = false;
    }
}
