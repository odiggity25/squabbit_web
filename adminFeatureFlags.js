import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

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
];

const FLAGS_DOC = ['configs', 'featureFlags'];

let db;
let remoteConfig = {}; // key -> { value, rolloutPercentage, whitelistedUserIds }

export function initFeatureFlags(fireDb) {
    db = fireDb;
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
    for (const flag of KNOWN_FLAGS) {
        listEl.appendChild(buildFlagCard(flag));
    }
}

// Reads the stored config for a flag, coercing missing/invalid fields to sane
// editor defaults so a brand-new flag renders cleanly.
function configFor(flag) {
    const stored = remoteConfig[flag.key] || {};
    const rollout = Number.isFinite(stored.rolloutPercentage) ? stored.rolloutPercentage : 0;
    const whitelist = Array.isArray(stored.whitelistedUserIds) ? stored.whitelistedUserIds : [];
    const hasValue = Object.prototype.hasOwnProperty.call(stored, 'value');
    return {
        value: hasValue ? stored.value : flag.defaultValue,
        rolloutPercentage: Math.min(100, Math.max(0, Math.round(rollout))),
        whitelistedUserIds: whitelist,
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

    const valueControl = buildValueControl(flag, cfg.value, markDirty);

    head.appendChild(keyWrap);
    head.appendChild(valueControl.el);
    card.appendChild(head);

    const desc = document.createElement('p');
    desc.className = 'text-muted small mb-2';
    desc.textContent = flag.description;
    card.appendChild(desc);

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

    // Whitelist: comma or newline separated user ids.
    const wlRow = document.createElement('div');
    wlRow.className = 'mb-2';
    const wlLabel = document.createElement('div');
    wlLabel.className = 'ff-label';
    wlLabel.textContent = 'Whitelisted user ids';
    const wl = document.createElement('textarea');
    wl.className = 'form-control form-control-sm';
    wl.rows = 2;
    wl.placeholder = 'Comma or newline separated; these users always get the value';
    wl.value = cfg.whitelistedUserIds.join(', ');
    wl.addEventListener('input', markDirty);
    wlRow.appendChild(wlLabel);
    wlRow.appendChild(wl);
    card.appendChild(wlRow);

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
        const whitelist = wl.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        saveBtn.disabled = true;
        status.className = 'small text-muted';
        status.textContent = 'Saving...';
        try {
            const entry = { value: parsed.value, rolloutPercentage: pct, whitelistedUserIds: whitelist };
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
