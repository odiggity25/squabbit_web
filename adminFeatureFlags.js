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

    // Header: key + type badge, then description.
    const head = document.createElement('div');
    head.className = 'd-flex align-items-center gap-2 mb-1';
    const keyEl = document.createElement('span');
    keyEl.className = 'ff-flag-key';
    keyEl.textContent = flag.key;
    const badge = document.createElement('span');
    badge.className = 'ff-type-badge';
    badge.textContent = flag.type;
    const dirtyDot = document.createElement('span');
    dirtyDot.className = 'ff-dirty-dot';
    dirtyDot.style.display = 'none';
    dirtyDot.title = 'Unsaved changes';
    head.appendChild(keyEl);
    head.appendChild(badge);
    head.appendChild(dirtyDot);
    card.appendChild(head);

    const desc = document.createElement('p');
    desc.className = 'text-muted small mb-3';
    desc.textContent = flag.description;
    card.appendChild(desc);

    const markDirty = () => { dirtyDot.style.display = 'inline-block'; };

    // Value editor.
    const valueWrap = document.createElement('div');
    valueWrap.className = 'mb-3';
    const valueLabel = document.createElement('div');
    valueLabel.className = 'ff-label';
    valueLabel.textContent = 'Value when on';
    valueWrap.appendChild(valueLabel);
    const valueControl = buildValueControl(flag, cfg.value, markDirty);
    valueWrap.appendChild(valueControl.el);
    card.appendChild(valueWrap);

    // Rollout slider + live split bar (the signature element).
    const rolloutWrap = document.createElement('div');
    rolloutWrap.className = 'mb-3';
    const rolloutHead = document.createElement('div');
    rolloutHead.className = 'ff-rollout-head';
    const rolloutLabel = document.createElement('span');
    rolloutLabel.className = 'ff-label mb-0';
    rolloutLabel.textContent = 'Rollout';
    const rolloutPct = document.createElement('span');
    rolloutPct.className = 'ff-rollout-pct';
    rolloutPct.textContent = cfg.rolloutPercentage + '%';
    rolloutHead.appendChild(rolloutLabel);
    rolloutHead.appendChild(rolloutPct);
    rolloutWrap.appendChild(rolloutHead);

    const splitOn = document.createElement('div');
    splitOn.className = 'ff-split-on';
    splitOn.style.width = cfg.rolloutPercentage + '%';
    const split = document.createElement('div');
    split.className = 'ff-split';
    split.appendChild(splitOn);
    rolloutWrap.appendChild(split);

    const legend = document.createElement('div');
    legend.className = 'ff-split-legend';
    const legendOn = document.createElement('span');
    const legendOff = document.createElement('span');
    const setLegend = (pct) => {
        legendOn.textContent = 'on ' + pct + '%';
        legendOff.textContent = (100 - pct) + '% default';
    };
    setLegend(cfg.rolloutPercentage);
    legend.appendChild(legendOn);
    legend.appendChild(legendOff);
    rolloutWrap.appendChild(legend);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'form-range mt-2';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(cfg.rolloutPercentage);
    slider.addEventListener('input', () => {
        const pct = parseInt(slider.value, 10);
        rolloutPct.textContent = pct + '%';
        splitOn.style.width = pct + '%';
        setLegend(pct);
        markDirty();
    });
    rolloutWrap.appendChild(slider);
    card.appendChild(rolloutWrap);

    // Whitelist: one user id per line.
    const wlWrap = document.createElement('div');
    wlWrap.className = 'mb-3';
    const wlLabel = document.createElement('div');
    wlLabel.className = 'ff-label';
    wlLabel.textContent = 'Whitelisted user ids (one per line)';
    const wl = document.createElement('textarea');
    wl.className = 'form-control form-control-sm';
    wl.rows = Math.max(2, cfg.whitelistedUserIds.length);
    wl.placeholder = 'Always get the value, ignoring rollout';
    wl.value = cfg.whitelistedUserIds.join('\n');
    wl.addEventListener('input', markDirty);
    wlWrap.appendChild(wlLabel);
    wlWrap.appendChild(wl);
    card.appendChild(wlWrap);

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
        const pct = parseInt(slider.value, 10);
        const whitelist = wl.value.split('\n').map((s) => s.trim()).filter(Boolean);
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

// Returns { el, read } where read() -> { value } or { error }.
function buildValueControl(flag, currentValue, markDirty) {
    if (flag.type === 'boolean') {
        const wrap = document.createElement('div');
        wrap.className = 'form-check form-switch';
        const input = document.createElement('input');
        input.className = 'form-check-input';
        input.type = 'checkbox';
        input.role = 'switch';
        input.id = 'ff-val-' + flag.key;
        input.checked = currentValue === true;
        input.addEventListener('change', markDirty);
        const label = document.createElement('label');
        label.className = 'form-check-label small';
        label.htmlFor = input.id;
        const syncLabel = () => { label.textContent = input.checked ? 'true' : 'false'; };
        syncLabel();
        input.addEventListener('change', syncLabel);
        wrap.appendChild(input);
        wrap.appendChild(label);
        return { el: wrap, read: () => ({ value: input.checked }) };
    }

    if (flag.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.className = 'form-control form-control-sm';
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
    input.className = 'form-control form-control-sm';
    input.value = (typeof currentValue === 'string') ? currentValue : '';
    input.addEventListener('input', markDirty);
    return { el: input, read: () => ({ value: input.value }) };
}
