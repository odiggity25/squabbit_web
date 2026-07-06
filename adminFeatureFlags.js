import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

// Base for a user's public profile deeplink (parsed on add, rendered on display).
const PROFILE_LINK_BASE = 'https://app.squabbitgolf.com/user?id=';

// The Firestore doc `configs/featureFlags` is the source of truth for the flag
// catalog: this admin builds its cards from whatever keys the doc contains, and
// the app resolves flags by key against the same doc. There is no hardcoded
// flag list here. A flag's editor `type` is inferred from its stored `value`.
// To configure a new flag, use "Add flag" and enter the exact key the app reads.

const FLAGS_DOC = ['configs', 'featureFlags'];

// Infers the editor type ('boolean' | 'number' | 'text') from a stored value.
function inferType(value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    return 'text';
}

// The initial value for a freshly added flag of the given type.
function defaultForType(type) {
    if (type === 'number') return 0;
    if (type === 'text') return '';
    return false;
}

// Builds the flag descriptors to render, one per key in the loaded doc, sorted.
function flagsFromRemote() {
    return Object.keys(remoteConfig).sort().map((key) => {
        const entry = remoteConfig[key] || {};
        const basis = entry.value !== undefined ? entry.value : entry.defaultValue;
        return { key, type: inferType(basis), description: entry.description || '' };
    });
}

let db;
let resolveWhitelistUsersCallable;
let remoteConfig = {}; // key -> { value, description, rolloutPercentage, whitelistedUserIds, minVersionAndroid, minVersionIos }

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
    renderFlags();
}

function renderFlags() {
    const listEl = document.getElementById('feature-flags-list');
    listEl.innerHTML = '';
    listEl.appendChild(buildAddFlagControl());
    const flags = flagsFromRemote();
    if (flags.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-muted small mb-0';
        empty.textContent = 'No feature flags configured yet. Add one above (use the exact key the app reads).';
        listEl.appendChild(empty);
    }
    for (const flag of flags) listEl.appendChild(buildFlagCard(flag));
}

// "Add flag" row: key + type + optional description. Creates the flag in the doc
// (with a type-appropriate default value) so it appears as a card to configure.
function buildAddFlagControl() {
    const wrap = document.createElement('div');
    wrap.className = 'ff-flag mb-3';

    const label = document.createElement('div');
    label.className = 'ff-label';
    label.textContent = 'Add flag';
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.className = 'd-flex flex-wrap align-items-center gap-2';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'form-control form-control-sm';
    keyInput.style.maxWidth = '220px';
    keyInput.placeholder = 'flag key (must match the app)';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'form-select form-select-sm';
    typeSelect.style.width = '110px';
    for (const t of ['boolean', 'number', 'text']) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
    }

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'form-control form-control-sm flex-grow-1';
    descInput.style.minWidth = '160px';
    descInput.placeholder = 'description (optional)';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline-primary btn-sm flex-shrink-0';
    addBtn.textContent = 'Add';

    const status = document.createElement('span');
    status.className = 'small text-muted';

    addBtn.addEventListener('click', async () => {
        const key = keyInput.value.trim();
        if (!key) { status.className = 'small text-danger'; status.textContent = 'Enter a key.'; return; }
        if (Object.prototype.hasOwnProperty.call(remoteConfig, key)) {
            status.className = 'small text-danger'; status.textContent = 'That flag already exists.'; return;
        }
        const type = typeSelect.value;
        const entry = {
            value: defaultForType(type),
            defaultValue: defaultForType(type),
            description: descInput.value.trim(),
            rolloutPercentage: 0,
            whitelistedUserIds: [],
            minVersionAndroid: 0,
            minVersionIos: 0,
        };
        addBtn.disabled = true;
        status.className = 'small text-muted';
        status.textContent = 'Adding...';
        try {
            await setDoc(doc(db, ...FLAGS_DOC), { [key]: entry }, { merge: true });
            remoteConfig[key] = entry;
            renderFlags();
        } catch (e) {
            status.className = 'small text-danger';
            status.textContent = 'Add failed: ' + (e.message || e);
        } finally {
            addBtn.disabled = false;
        }
    });

    row.appendChild(keyInput);
    row.appendChild(typeSelect);
    row.appendChild(descInput);
    row.appendChild(addBtn);
    wrap.appendChild(row);
    wrap.appendChild(status);
    return wrap;
}

// Reads the stored config for a flag, coercing missing/invalid fields to sane
// editor defaults.
function configFor(flag) {
    const stored = remoteConfig[flag.key] || {};
    const rollout = Number.isFinite(stored.rolloutPercentage) ? stored.rolloutPercentage : 0;
    const whitelist = Array.isArray(stored.whitelistedUserIds) ? stored.whitelistedUserIds : [];
    const minVersionAndroid = Number.isFinite(stored.minVersionAndroid) ? stored.minVersionAndroid : 0;
    const minVersionIos = Number.isFinite(stored.minVersionIos) ? stored.minVersionIos : 0;
    const hasValue = Object.prototype.hasOwnProperty.call(stored, 'value');
    const hasDefault = Object.prototype.hasOwnProperty.call(stored, 'defaultValue');
    return {
        value: hasValue ? stored.value : defaultForType(flag.type),
        defaultValue: hasDefault ? stored.defaultValue : defaultForType(flag.type),
        description: stored.description || '',
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

    // Header: key + type badge on the left, value control (toggle/input) at the end.
    const head = document.createElement('div');
    head.className = 'd-flex align-items-center gap-2 mb-1';

    const keyWrap = document.createElement('div');
    keyWrap.className = 'd-flex align-items-center gap-2 flex-grow-1 min-w-0';
    const keyEl = document.createElement('span');
    keyEl.className = 'ff-flag-key';
    keyEl.textContent = flag.key;
    const badge = document.createElement('span');
    badge.className = 'ff-type-badge';
    badge.textContent = flag.type;
    keyWrap.appendChild(keyEl);
    keyWrap.appendChild(badge);
    keyWrap.appendChild(dirtyDot);

    // "Value" = what targeted (whitelisted / rolled-out) users receive.
    const valueLabel = document.createElement('span');
    valueLabel.className = 'text-muted small';
    valueLabel.textContent = 'Value';
    const valueControl = buildValueControl(flag, cfg.value, markDirty);

    head.appendChild(keyWrap);
    head.appendChild(valueLabel);
    head.appendChild(valueControl.el);
    card.appendChild(head);

    // Description: editable, stored on the flag's doc entry.
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'form-control form-control-sm mb-2';
    descInput.placeholder = 'description (optional)';
    descInput.value = cfg.description;
    descInput.addEventListener('input', markDirty);
    card.appendChild(descInput);

    // "Default" = the baseline the app uses when a user isn't targeted / is
    // offline. This is the value the client enum copies as the compiled default.
    const defaultRow = document.createElement('div');
    defaultRow.className = 'd-flex align-items-center gap-2 mb-2';
    const defaultLabel = document.createElement('span');
    defaultLabel.className = 'ff-label mb-0';
    defaultLabel.textContent = 'Default';
    const defaultControl = buildValueControl(flag, cfg.defaultValue, markDirty);
    defaultRow.appendChild(defaultLabel);
    defaultRow.appendChild(defaultControl.el);
    card.appendChild(defaultRow);

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
    card.appendChild(rolloutRow);

    // Min build gate: builds below this never get the value (0 = no gate). Web /
    // unknown builds run the latest code and are never gated. Surfaced as one
    // input by default; a toggle splits it into separate iOS / Android values.
    const minVersionControl = buildMinVersionControl(cfg, markDirty);
    card.appendChild(minVersionControl.el);

    // Whitelist: users who always get the value. Stored as auth ids, but shown
    // as hyperlinked names; users are added by pasting their profile deeplink.
    const whitelistControl = buildWhitelistControl(cfg, markDirty);
    card.appendChild(whitelistControl.el);

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
        const parsedDefault = defaultControl.read();
        if (parsedDefault.error) { status.className = 'small text-danger'; status.textContent = parsedDefault.error; return; }
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
            const entry = { value: parsed.value, defaultValue: parsedDefault.value, description: descInput.value.trim(), rolloutPercentage: pct, whitelistedUserIds: whitelist, minVersionAndroid, minVersionIos };
            await setDoc(doc(db, ...FLAGS_DOC), { [flag.key]: entry }, { merge: true });
            remoteConfig[flag.key] = entry;
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
    card.appendChild(footer);

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
