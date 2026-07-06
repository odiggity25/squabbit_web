import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

// Base for a user's public profile deeplink (parsed on add, rendered on display).
const PROFILE_LINK_BASE = 'https://app.squabbitgolf.com/user?id=';

// Mirror of the app's FeatureFlags registry (lib/utils/FeatureFlags/FeatureFlags.dart).
// Keep this in sync when flags are added or removed in the app. `type` is one of
// 'boolean' | 'text' | 'number' and selects the value editor + how the value is written.
const KNOWN_FLAGS = [
    {
        key: 'exampleFlag',
        type: 'boolean',
        description: 'Example feature flag demonstrating the flag system.',
        defaultValue: false,
    },
    {
        key: 'aiActionsEnabled',
        type: 'boolean',
        description: 'Enables the Squabbit AI actions layer (propose/apply group changes).',
        defaultValue: false,
    },
    {
        key: 'hostProUnlockEnabled',
        type: 'boolean',
        description: 'Offers the Host Pro unlock / paywall to users.',
        defaultValue: false,
    },
    {
        key: 'statsUnlockEnabled',
        type: 'boolean',
        description: 'Offers the Stats unlock / paywall to users.',
        defaultValue: false,
    },
];

const FLAGS_DOC = ['configs', 'featureFlags'];

let db;
let resolveWhitelistUsersCallable;
let remoteConfig = {}; // key -> { value, rolloutPercentage, whitelistedUserIds, minVersionAndroid, minVersionIos }

export function initFeatureFlags(fireDb, fireFunctions) {
    db = fireDb;
    resolveWhitelistUsersCallable = fireFunctions ? httpsCallable(fireFunctions, 'resolveWhitelistUsers') : null;
}

// Extracts a Squabbit user-doc id from a pasted profile deeplink
// (https://app.squabbitgolf.com/user?id=<userId>), falling back to a bare id.
function parseUserIdFromProfileLink(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed);
        const id = url.searchParams.get('id');
        if (id) return id.trim();
    } catch (_) { /* not a full URL; fall through */ }
    return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function result(msg, success) {
    const el = document.getElementById('feature-flags-result');
    if (!el) return;
    el.className = 'alert ' + (success ? 'alert-success' : 'alert-danger');
    el.textContent = msg;
    el.classList.remove('d-none');
    setTimeout(() => el.classList.add('d-none'), 4000);
}

export async function loadFeatureFlags() {
    const listEl = document.getElementById('feature-flags-list');
    listEl.innerHTML = '<p class="text-muted small">Loading...</p>';
    try {
        const snap = await getDoc(doc(db, ...FLAGS_DOC));
        remoteConfig = snap.exists() ? (snap.data() || {}) : {};
    } catch (e) {
        listEl.innerHTML = '';
        result('Could not load flags: ' + (e.message || e), false);
        return;
    }
    listEl.innerHTML = '';
    const sorted = KNOWN_FLAGS.slice().sort((a, b) => a.key.localeCompare(b.key));
    for (const flag of sorted) {
        listEl.appendChild(buildFlagCard(flag));
    }
}

// Reads the stored config for a flag, coercing missing/invalid fields to sane
// editor defaults so a brand-new flag renders cleanly.
function configFor(flag) {
    const stored = remoteConfig[flag.key] || {};
    const rollout = Number.isFinite(stored.rolloutPercentage) ? stored.rolloutPercentage : 0;
    const whitelist = Array.isArray(stored.whitelistedUserIds) ? stored.whitelistedUserIds : [];
    const minVersionAndroid = Number.isFinite(stored.minVersionAndroid) ? stored.minVersionAndroid : 0;
    const minVersionIos = Number.isFinite(stored.minVersionIos) ? stored.minVersionIos : 0;
    const hasValue = Object.prototype.hasOwnProperty.call(stored, 'value');
    return {
        value: hasValue ? stored.value : flag.defaultValue,
        rolloutPercentage: Math.min(100, Math.max(0, Math.round(rollout))),
        whitelistedUserIds: whitelist,
        minVersionAndroid: Math.max(0, Math.round(minVersionAndroid)),
        minVersionIos: Math.max(0, Math.round(minVersionIos)),
    };
}

function buildFlagCard(flag) {
    const cfg = configFor(flag);

    const card = document.createElement('div');
    card.className = 'ff-flag';

    const dirtyDot = document.createElement('span');
    dirtyDot.className = 'ff-dirty-dot';
    dirtyDot.style.display = 'none';
    dirtyDot.title = 'Unsaved changes';
    const markDirty = () => { dirtyDot.style.display = 'inline-block'; };

    // ---- Compact summary: always visible, click / Enter to expand ----
    const summary = document.createElement('div');
    summary.className = 'ff-summary';
    summary.setAttribute('role', 'button');
    summary.setAttribute('tabindex', '0');
    summary.setAttribute('aria-expanded', 'false');

    const chevron = document.createElement('span');
    chevron.className = 'ff-chevron';
    chevron.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const keyWrap = document.createElement('div');
    keyWrap.className = 'd-flex align-items-center gap-2 min-w-0';
    const keyEl = document.createElement('span');
    keyEl.className = 'ff-flag-key';
    keyEl.textContent = flag.key;
    const badge = document.createElement('span');
    badge.className = 'ff-type-badge';
    badge.textContent = flag.type;
    keyWrap.appendChild(keyEl);
    keyWrap.appendChild(badge);
    keyWrap.appendChild(dirtyDot);

    const metaWrap = document.createElement('div');
    metaWrap.className = 'ff-summary-meta';
    const facts = document.createElement('span');
    facts.className = 'ff-meta-facts';
    const pill = document.createElement('span');
    pill.className = 'ff-value-pill';
    metaWrap.appendChild(facts);
    metaWrap.appendChild(pill);

    summary.appendChild(chevron);
    summary.appendChild(keyWrap);
    summary.appendChild(metaWrap);
    card.appendChild(summary);

    // Reflect the *saved* config in the rail state, gating facts and value pill.
    const updateSummary = (c) => {
        const isOn = flag.type === 'boolean'
            ? c.value === true
            : (c.value !== undefined && c.value !== null && c.value !== '' && c.value !== false);
        let state = 'off';
        if (isOn) state = (c.rolloutPercentage < 100 || c.minVersionAndroid > 0 || c.minVersionIos > 0) ? 'partial' : 'on';
        card.dataset.state = state;

        const parts = [`${c.rolloutPercentage}% rollout`];
        const wl = Array.isArray(c.whitelistedUserIds) ? c.whitelistedUserIds.length : 0;
        if (wl > 0) parts.push(`${wl} whitelisted`);
        if (c.minVersionAndroid > 0 || c.minVersionIos > 0) {
            if (c.minVersionAndroid === c.minVersionIos) parts.push(`build ≥ ${c.minVersionAndroid}`);
            else parts.push(`iOS ≥ ${c.minVersionIos} · Android ≥ ${c.minVersionAndroid}`);
        }
        facts.textContent = parts.join(' · ');

        if (flag.type === 'boolean') {
            pill.textContent = isOn ? 'On' : 'Off';
            pill.className = 'ff-value-pill ' + (isOn ? 'on' : 'off');
        } else {
            const raw = (c.value === undefined || c.value === null || c.value === '') ? '—' : String(c.value);
            pill.textContent = raw.length > 20 ? raw.slice(0, 20) + '…' : raw;
            pill.className = 'ff-value-pill val ' + (isOn ? 'on' : 'off');
        }
    };
    updateSummary(cfg);

    const toggleExpanded = () => {
        const expanded = card.classList.toggle('expanded');
        summary.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };
    summary.addEventListener('click', toggleExpanded);
    summary.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(); }
    });

    // ---- Expandable body: every edit field lives here, hidden until expanded ----
    const body = document.createElement('div');
    body.className = 'ff-body';

    const desc = document.createElement('p');
    desc.className = 'text-muted small mb-3';
    desc.textContent = flag.description;
    body.appendChild(desc);

    // Value editor (was previously in the header; now an explicit labeled row).
    const valueControl = buildValueControl(flag, cfg.value, markDirty);
    const valueRow = document.createElement('div');
    valueRow.className = 'd-flex align-items-center gap-2 mb-3';
    const valueLabel = document.createElement('span');
    valueLabel.className = 'ff-label mb-0';
    valueLabel.textContent = 'Value';
    valueRow.appendChild(valueLabel);
    valueRow.appendChild(valueControl.el);
    body.appendChild(valueRow);

    // Rollout: a plain 0-100 number, tap to edit.
    const rolloutRow = document.createElement('div');
    rolloutRow.className = 'd-flex align-items-center gap-2 mb-2';
    const rolloutLabel = document.createElement('span');
    rolloutLabel.className = 'ff-label mb-0';
    rolloutLabel.textContent = 'Rollout';
    const rolloutInput = document.createElement('input');
    rolloutInput.type = 'number';
    rolloutInput.min = '0';
    rolloutInput.max = '100';
    rolloutInput.step = '1';
    rolloutInput.className = 'form-control form-control-sm';
    rolloutInput.style.width = '72px';
    rolloutInput.value = String(cfg.rolloutPercentage);
    rolloutInput.addEventListener('input', markDirty);
    const pctSign = document.createElement('span');
    pctSign.className = 'text-muted small';
    pctSign.textContent = '%';
    rolloutRow.appendChild(rolloutLabel);
    rolloutRow.appendChild(rolloutInput);
    rolloutRow.appendChild(pctSign);
    body.appendChild(rolloutRow);

    // Min build gate: builds below this never get the value (0 = no gate). Web /
    // unknown builds run the latest code and are never gated. Surfaced as one
    // input by default; a toggle splits it into separate iOS / Android values.
    const minVersionControl = buildMinVersionControl(cfg, markDirty);
    body.appendChild(minVersionControl.el);

    // Whitelist: users who always get the value. Stored as auth ids, but shown
    // as hyperlinked names; users are added by pasting their profile deeplink.
    const whitelistControl = buildWhitelistControl(cfg, markDirty);
    body.appendChild(whitelistControl.el);

    // Save.
    const footer = document.createElement('div');
    footer.className = 'd-flex align-items-center gap-2';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Save';
    const status = document.createElement('span');
    status.className = 'small text-muted';
    saveBtn.addEventListener('click', async () => {
        const parsed = valueControl.read();
        if (parsed.error) { status.className = 'small text-danger'; status.textContent = parsed.error; return; }
        let pct = parseInt(rolloutInput.value, 10);
        if (!Number.isFinite(pct)) pct = 0;
        pct = Math.min(100, Math.max(0, pct));
        rolloutInput.value = String(pct);
        const { minVersionAndroid, minVersionIos } = minVersionControl.read();
        const whitelist = whitelistControl.read();
        saveBtn.disabled = true;
        status.className = 'small text-muted';
        status.textContent = 'Saving...';
        try {
            const entry = { value: parsed.value, rolloutPercentage: pct, whitelistedUserIds: whitelist, minVersionAndroid, minVersionIos };
            await setDoc(doc(db, ...FLAGS_DOC), { [flag.key]: entry }, { merge: true });
            remoteConfig[flag.key] = entry;
            updateSummary(entry);
            dirtyDot.style.display = 'none';
            status.className = 'small text-success';
            status.textContent = 'Saved';
            setTimeout(() => { status.textContent = ''; }, 2500);
        } catch (e) {
            status.className = 'small text-danger';
            status.textContent = 'Save failed: ' + (e.message || e);
        } finally {
            saveBtn.disabled = false;
        }
    });
    footer.appendChild(saveBtn);
    footer.appendChild(status);
    body.appendChild(footer);

    card.appendChild(body);
    return card;
}

// Whitelist control. Stores auth ids, but renders each as a hyperlinked name
// (resolved via the resolveWhitelistUsers callable) with a remove button. New
// entries are added by pasting a profile deeplink, which is translated to the
// user's auth id under the hood. read() -> array of auth ids.
function buildWhitelistControl(cfg, markDirty) {
    const authIds = Array.isArray(cfg.whitelistedUserIds) ? cfg.whitelistedUserIds.slice() : [];
    const nameCache = new Map(); // authId -> { userId, name, avatar }

    const wrap = document.createElement('div');
    wrap.className = 'mb-2';

    const label = document.createElement('div');
    label.className = 'ff-label';
    label.textContent = 'Whitelisted users';
    wrap.appendChild(label);

    const chips = document.createElement('div');
    chips.className = 'd-flex flex-wrap gap-2 mb-2';
    wrap.appendChild(chips);

    const empty = document.createElement('span');
    empty.className = 'text-muted small';
    empty.textContent = 'No whitelisted users.';

    const chipFor = (authId) => {
        const chip = document.createElement('span');
        chip.className = 'badge d-inline-flex align-items-center gap-1 bg-light text-dark border';
        chip.style.padding = '6px 8px';
        chip.style.fontWeight = '500';

        const info = nameCache.get(authId);
        if (info && info.name) {
            const link = document.createElement('a');
            link.href = PROFILE_LINK_BASE + encodeURIComponent(info.userId);
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'text-decoration-none';
            link.textContent = info.name;
            chip.appendChild(link);
        } else {
            // Unresolved (e.g. an anonymous auth session with no profile doc, or
            // the lookup failed). Show a truncated auth id so the row is still
            // identifiable and removable.
            const raw = document.createElement('span');
            raw.className = 'text-muted font-monospace';
            raw.title = authId;
            raw.textContent = authId.length > 10 ? authId.slice(0, 10) + '…' : authId;
            chip.appendChild(raw);
        }

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-close';
        remove.style.fontSize = '0.6rem';
        remove.setAttribute('aria-label', 'Remove');
        remove.addEventListener('click', () => {
            const index = authIds.indexOf(authId);
            if (index >= 0) authIds.splice(index, 1);
            renderChips();
            markDirty();
        });
        chip.appendChild(remove);
        return chip;
    };

    const renderChips = () => {
        chips.innerHTML = '';
        if (authIds.length === 0) {
            chips.appendChild(empty);
            return;
        }
        for (const authId of authIds) chips.appendChild(chipFor(authId));
    };

    // Add-by-deeplink row.
    const addRow = document.createElement('div');
    addRow.className = 'd-flex align-items-center gap-2';
    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'form-control form-control-sm';
    linkInput.placeholder = 'Paste a profile link (app.squabbitgolf.com/user?id=...)';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline-primary btn-sm flex-shrink-0';
    addBtn.textContent = 'Add user';
    const addStatus = document.createElement('span');
    addStatus.className = 'small text-muted';

    const doAdd = async () => {
        const userId = parseUserIdFromProfileLink(linkInput.value);
        if (!userId) {
            addStatus.className = 'small text-danger';
            addStatus.textContent = 'Paste a valid profile link.';
            return;
        }
        if (!resolveWhitelistUsersCallable) {
            addStatus.className = 'small text-danger';
            addStatus.textContent = 'User lookup unavailable.';
            return;
        }
        addBtn.disabled = true;
        addStatus.className = 'small text-muted';
        addStatus.textContent = 'Looking up...';
        try {
            const res = await resolveWhitelistUsersCallable({ userIds: [userId] });
            const user = (res.data && res.data.users && res.data.users[0]) || null;
            if (!user || !user.authId) {
                addStatus.className = 'small text-danger';
                addStatus.textContent = 'No user found for that link.';
                return;
            }
            if (authIds.includes(user.authId)) {
                addStatus.className = 'small text-muted';
                addStatus.textContent = (user.name || 'That user') + ' is already whitelisted.';
                return;
            }
            nameCache.set(user.authId, { userId: user.userId, name: user.name, avatar: user.avatar });
            authIds.push(user.authId);
            linkInput.value = '';
            addStatus.textContent = '';
            renderChips();
            markDirty();
        } catch (e) {
            addStatus.className = 'small text-danger';
            addStatus.textContent = 'Lookup failed: ' + (e.message || e);
        } finally {
            addBtn.disabled = false;
        }
    };

    addBtn.addEventListener('click', doAdd);
    linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    addRow.appendChild(linkInput);
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);
    wrap.appendChild(addStatus);

    renderChips();

    // Resolve names for the already-stored auth ids, then re-render.
    if (authIds.length > 0 && resolveWhitelistUsersCallable) {
        resolveWhitelistUsersCallable({ authIds: authIds.slice() })
            .then((res) => {
                const users = (res.data && res.data.users) || [];
                for (const user of users) {
                    if (user.authId) nameCache.set(user.authId, { userId: user.userId, name: user.name, avatar: user.avatar });
                }
                renderChips();
            })
            .catch(() => { /* leave raw-id chips on failure */ });
    }

    return {
        el: wrap,
        read: () => authIds.slice(),
    };
}

// Min build gate control. Surfaced as a single "Min build" input that applies to
// both platforms, with a "Split iOS / Android" toggle to edit each separately.
// The split toggle initializes on load from whether the two stored values differ.
// Returns { el, read } where read() -> { minVersionAndroid, minVersionIos }.
function buildMinVersionControl(cfg, markDirty) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-2';

    const numberInput = (value) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.className = 'form-control form-control-sm';
        input.style.width = '110px';
        input.value = String(value);
        input.addEventListener('input', markDirty);
        return input;
    };

    const platformRow = (text, input) => {
        const row = document.createElement('div');
        row.className = 'd-flex align-items-center gap-2 mb-1';
        const label = document.createElement('span');
        label.className = 'text-muted small';
        label.style.width = '64px';
        label.textContent = text;
        row.appendChild(label);
        row.appendChild(input);
        return row;
    };

    // Header: "Min build" label + the split toggle.
    const header = document.createElement('div');
    header.className = 'd-flex align-items-center gap-2 mb-1';
    const label = document.createElement('span');
    label.className = 'ff-label mb-0';
    label.textContent = 'Min build';
    const splitWrap = document.createElement('label');
    splitWrap.className = 'form-check form-switch m-0 ms-auto d-flex align-items-center gap-1';
    const splitInput = document.createElement('input');
    splitInput.className = 'form-check-input m-0';
    splitInput.type = 'checkbox';
    splitInput.role = 'switch';
    const splitLabel = document.createElement('span');
    splitLabel.className = 'text-muted small';
    splitLabel.textContent = 'Split iOS / Android';
    splitWrap.appendChild(splitInput);
    splitWrap.appendChild(splitLabel);
    header.appendChild(label);
    header.appendChild(splitWrap);
    wrap.appendChild(header);

    // Unified input (both platforms). Equal to either when unsplit.
    const unifiedInput = numberInput(cfg.minVersionAndroid);
    const unifiedHint = document.createElement('span');
    unifiedHint.className = 'text-muted small';
    unifiedHint.textContent = '0 = no gate';
    const unifiedRow = document.createElement('div');
    unifiedRow.className = 'd-flex align-items-center gap-2';
    unifiedRow.appendChild(unifiedInput);
    unifiedRow.appendChild(unifiedHint);
    wrap.appendChild(unifiedRow);

    // Split inputs (iOS + Android).
    const iosInput = numberInput(cfg.minVersionIos);
    const androidInput = numberInput(cfg.minVersionAndroid);
    const splitRows = document.createElement('div');
    splitRows.appendChild(platformRow('iOS', iosInput));
    splitRows.appendChild(platformRow('Android', androidInput));
    wrap.appendChild(splitRows);

    const applyVisibility = () => {
        unifiedRow.style.display = splitInput.checked ? 'none' : '';
        splitRows.style.display = splitInput.checked ? '' : 'none';
    };

    // Start split when the stored platform values differ.
    splitInput.checked = cfg.minVersionAndroid !== cfg.minVersionIos;
    applyVisibility();

    splitInput.addEventListener('change', () => {
        if (splitInput.checked) {
            // Entering split: seed both platforms from the unified value.
            iosInput.value = unifiedInput.value;
            androidInput.value = unifiedInput.value;
        } else {
            // Collapsing to unified: seed from the Android value.
            unifiedInput.value = androidInput.value;
        }
        applyVisibility();
        markDirty();
    });

    const readOne = (input) => {
        let n = parseInt(input.value, 10);
        if (!Number.isFinite(n)) n = 0;
        n = Math.max(0, n);
        input.value = String(n);
        return n;
    };

    return {
        el: wrap,
        read: () => {
            if (splitInput.checked) {
                return { minVersionAndroid: readOne(androidInput), minVersionIos: readOne(iosInput) };
            }
            const v = readOne(unifiedInput);
            return { minVersionAndroid: v, minVersionIos: v };
        },
    };
}

// Returns { el, read } where read() -> { value } or { error }. For booleans the
// control is a switch placed at the end of the card header.
function buildValueControl(flag, currentValue, markDirty) {
    if (flag.type === 'boolean') {
        const wrap = document.createElement('div');
        wrap.className = 'form-check form-switch m-0 flex-shrink-0';
        const input = document.createElement('input');
        input.className = 'form-check-input ff-switch';
        input.type = 'checkbox';
        input.role = 'switch';
        input.checked = currentValue === true;
        input.addEventListener('change', markDirty);
        wrap.appendChild(input);
        return { el: wrap, read: () => ({ value: input.checked }) };
    }

    if (flag.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.className = 'form-control form-control-sm flex-shrink-0';
        input.style.width = '120px';
        input.value = (typeof currentValue === 'number') ? String(currentValue) : '';
        input.addEventListener('input', markDirty);
        return {
            el: input,
            read: () => {
                const n = parseFloat(input.value);
                if (!Number.isFinite(n)) return { error: 'Enter a valid number' };
                return { value: n };
            },
        };
    }

    // text
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control form-control-sm flex-shrink-0';
    input.style.maxWidth = '220px';
    input.value = (typeof currentValue === 'string') ? currentValue : '';
    input.addEventListener('input', markDirty);
    return { el: input, read: () => ({ value: input.value }) };
}
