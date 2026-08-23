import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

// Same Firebase config + modular SDK (v11.0.1) as the other admin pages. This
// page is a sysAdmin-only earnings dashboard for the monetization ledger; all
// aggregation happens in the `getEarningsSummary` callable (the ledger is
// otherwise read-your-own-only), and this page just renders the result.
const firebaseConfig = {
    apiKey: 'AIzaSyDGVjvgrebAuRyRHOrztVLhRaUCP0N6TVM',
    appId: '1:535750845572:web:46e4c26866e4ef23584ed1',
    messagingSenderId: '535750845572',
    projectId: 'squabbit-2019',
    storageBucket: 'squabbit-2019.appspot.com',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);

const PRODUCT_COLORS = { sub: '#C8A035', onetime: '#1E7A4A', playerPro: '#7C3AED', stats: '#2563EB' };

// Server product key -> web color / label, for the recent-payments rows.
const PRODUCT_META = {
    sub: { color: PRODUCT_COLORS.sub, label: 'Host Pro subscription' },
    oneTime: { color: PRODUCT_COLORS.onetime, label: 'Host Pro one-time' },
    playerPro: { color: PRODUCT_COLORS.playerPro, label: 'Player Pro' },
    stats: { color: PRODUCT_COLORS.stats, label: 'Player Pro one-time' },
};
const loginSection = document.getElementById('login-section');
const adminContent = document.getElementById('admin-content');
const loading = document.getElementById('loading');
const loginError = document.getElementById('login-error');
const signedInAs = document.getElementById('signed-in-as');
const loadError = document.getElementById('load-error');
const refreshBtn = document.getElementById('refresh-btn');
const earningsLoading = document.getElementById('earnings-loading');
const earningsBody = document.getElementById('earnings-body');

// The full response from getEarningsSummary. Toggles re-render from this with no
// refetch (the daily series is rolled up to the chosen granularity client-side).
let summary = null;
let metric = 'gross';        // 'gross' | 'net'
let grain = 'daily';         // 'daily' | 'weekly' | 'monthly'
let displayCurrency = 'USD'; // 'USD' | 'CAD'
// Date range filter. Presets are rolling windows ending today (Eastern Time);
// 'all' shows the full history. Data is day-granular, so 'today' is the current
// ET day so far. Custom uses the two date inputs (either bound optional).
let rangePreset = 'all';     // 'all' | 'today' | 'yesterday' | '7d' | '30d' | '365d' | 'custom'
let customStart = null;      // 'YYYY-MM-DD' or null
let customEnd = null;        // 'YYYY-MM-DD' or null
let chartInstance = null;

// The ledger is aggregated in USD; CAD display multiplies by the inverse of the
// summary's CAD->USD rate. Approximate, like the rest of the FX here.
function currencyFactor() {
    if (displayCurrency === 'CAD') {
        const cadToUsd = (summary && summary.fxRates && summary.fxRates.CAD) || 0.73;
        return 1 / cadToUsd;
    }
    return 1;
}

function currencyFormatter(whole) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency, maximumFractionDigits: whole ? 0 : 2 });
}

// Format a USD value in the selected display currency.
function fmtMoney(usdValue) {
    return currencyFormatter(false).format((usdValue || 0) * currencyFactor());
}

// Format a value that is ALREADY expressed in the display currency.
function fmtDisplay(value, whole) {
    return currencyFormatter(whole).format(value || 0);
}

function showLogin() {
    loading.style.display = 'none';
    loginSection.style.display = 'block';
    adminContent.style.display = 'none';
}

function showLoading() {
    loading.style.display = 'block';
    loginSection.style.display = 'none';
    adminContent.style.display = 'none';
}

async function showAdmin(email) {
    loading.style.display = 'none';
    loginSection.style.display = 'none';
    adminContent.style.display = 'block';
    signedInAs.textContent = email;
    await loadEarnings();
}

// Fetch the latest earnings summary. The dashboard no longer auto-updates; the
// admin refreshes on demand with the Refresh button.
async function loadEarnings() {
    loadError.classList.add('d-none');
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing…';
    try {
        const result = await httpsCallable(functions, 'getEarningsSummary')();
        summary = result.data;
        renderAll();
        // First successful load: swap the spinner out for the real content.
        // On later refreshes both of these are already in their final state.
        earningsLoading.classList.add('d-none');
        earningsBody.classList.remove('d-none');
    } catch (e) {
        loadError.textContent = 'Could not load earnings: ' + (e.message || e);
        loadError.classList.remove('d-none');
        // Drop the spinner so a failed first load shows only the error, not a
        // stuck loader. Any already-rendered content stays put on a refresh.
        earningsLoading.classList.add('d-none');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
    }
}

// ----- Date range filter -----

// Today's Eastern-Time day key, matching how the server buckets days.
function todayKeyEt() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// The active filter as inclusive { start, end } 'YYYY-MM-DD' keys, or null for
// all time. Rolling presets end today and include it (so '7 days' is today plus
// the previous six).
function activeRange() {
    if (rangePreset === 'all') return null;
    const today = todayKeyEt();
    if (rangePreset === 'custom') {
        if (!customStart && !customEnd) return null;
        const start = customStart || '0000-01-01';
        const end = customEnd || today;
        return start <= end ? { start, end } : { start: end, end: start };
    }
    if (rangePreset === 'today') return { start: today, end: today };
    if (rangePreset === 'yesterday') {
        const yd = parseDay(today);
        yd.setUTCDate(yd.getUTCDate() - 1);
        const key = yd.toISOString().slice(0, 10);
        return { start: key, end: key };
    }
    const spanDays = rangePreset === '7d' ? 7 : rangePreset === '30d' ? 30 : 365;
    const startDate = parseDay(today);
    startDate.setUTCDate(startDate.getUTCDate() - (spanDays - 1));
    return { start: startDate.toISOString().slice(0, 10), end: today };
}

// The daily series limited to the active range (all of it when unfiltered).
function filteredDaily() {
    const all = (summary && Array.isArray(summary.daily)) ? summary.daily : [];
    const range = activeRange();
    if (!range) return all;
    return all.filter((day) => day.day >= range.start && day.day <= range.end);
}

// ----- Roll the daily series up to the chosen granularity -----

// 'YYYY-MM-DD' -> Date at UTC midnight.
function parseDay(dayKey) {
    return new Date(dayKey + 'T00:00:00Z');
}

// Bucket key + display label for a day string, per granularity. Weekly buckets
// start on the Monday of that day's ISO week.
function bucketFor(dayKey, granularity) {
    const date = parseDay(dayKey);
    if (granularity === 'daily') {
        return { key: dayKey, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
    }
    if (granularity === 'weekly') {
        const monday = new Date(date);
        const weekday = (monday.getUTCDay() + 6) % 7; // 0 = Monday
        monday.setUTCDate(monday.getUTCDate() - weekday);
        const key = monday.toISOString().slice(0, 10);
        return { key, label: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
    }
    const key = dayKey.slice(0, 7); // YYYY-MM
    return { key, label: parseDay(key + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) };
}

// Returns [{ key, label, sub, onetime, stats, count }] sorted ascending, using
// the current metric (gross vs net).
function rollup() {
    if (!summary) return [];
    const buckets = new Map();
    for (const day of filteredDaily()) {
        const values = day[metric] || {};
        const { key, label } = bucketFor(day.day, grain);
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { key, label, sub: 0, onetime: 0, playerPro: 0, stats: 0, count: 0 };
            buckets.set(key, bucket);
        }
        bucket.sub += values.sub || 0;
        bucket.onetime += values.oneTime || 0;
        bucket.playerPro += values.playerPro || 0;
        bucket.stats += values.stats || 0;
        bucket.count += day.count || 0;
    }
    return [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ----- Render -----

function renderAll() {
    renderHeadline();
    renderChart(rollup());
    renderRecent();
    renderFootnote();
}

// Totals for the current view. All-time uses the server totals (which carry
// exact per-product purchase counts); a date range is summed from the daily
// series, which has per-product gross/net but only a whole-day purchase count,
// so per-product counts are unavailable (hasProductCounts = false).
function viewTotals() {
    if (!activeRange()) {
        const totals = (summary && summary.totals) || { gross: 0, net: 0, count: 0, byProduct: {} };
        return { totals, hasProductCounts: true };
    }
    const byProduct = {
        sub: { gross: 0, net: 0 },
        oneTime: { gross: 0, net: 0 },
        playerPro: { gross: 0, net: 0 },
        stats: { gross: 0, net: 0 },
    };
    let gross = 0, net = 0, count = 0;
    for (const day of filteredDaily()) {
        for (const p of ['sub', 'oneTime', 'playerPro', 'stats']) {
            const g = (day.gross && day.gross[p]) || 0;
            const n = (day.net && day.net[p]) || 0;
            byProduct[p].gross += g;
            byProduct[p].net += n;
            gross += g;
            net += n;
        }
        count += day.count || 0;
    }
    return { totals: { gross, net, count, byProduct }, hasProductCounts: false };
}

function renderHeadline() {
    const { totals, hasProductCounts } = viewTotals();
    const byProduct = totals.byProduct || {};
    const heroValue = metric === 'net' ? totals.net : totals.gross;
    const otherValue = metric === 'net' ? totals.gross : totals.net;
    const otherLabel = metric === 'net' ? 'gross' : 'est. net';

    document.getElementById('hero-label').textContent = metric === 'net' ? 'Estimated net' : 'Total gross';
    document.getElementById('hero-amount').innerHTML = accentedAmount(heroValue);
    document.getElementById('hero-subline').textContent = totals.count > 0
        ? `${totals.count} ${totals.count === 1 ? 'purchase' : 'purchases'} · ${otherLabel} ${fmtMoney(otherValue)}`
        : 'No purchases yet';

    setProductCard('sub', byProduct.sub, hasProductCounts);
    setProductCard('onetime', byProduct.oneTime, hasProductCounts);
    setProductCard('playerPro', byProduct.playerPro, hasProductCounts);
    setProductCard('stats', byProduct.stats, hasProductCounts);
}

function setProductCard(id, product, hasCount) {
    const bucket = product || { gross: 0, net: 0, count: 0 };
    const value = metric === 'net' ? bucket.net : bucket.gross;
    document.getElementById(`card-${id}-val`).textContent = fmtMoney(value);
    const count = bucket.count || 0;
    // Per-product counts aren't available for a date range, so leave the meta
    // blank there rather than show a wrong number.
    document.getElementById(`card-${id}-meta`).textContent = hasCount
        ? `${count} ${count === 1 ? 'purchase' : 'purchases'}`
        : '';
}

// Renders the currency symbol in the brand green, the digits in ink.
function accentedAmount(value) {
    const formatted = fmtMoney(value);
    const match = formatted.match(/^(\D+)(.*)$/);
    if (!match) return escapeHtml(formatted);
    return `<span class="cur">${escapeHtml(match[1])}</span>${escapeHtml(match[2])}`;
}

async function renderChart(buckets) {
    const chartEmpty = document.getElementById('chart-empty');
    const canvas = document.getElementById('earnings-chart');
    if (!buckets.length) {
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        canvas.style.display = 'none';
        chartEmpty.textContent = activeRange() ? 'No earnings in this date range.' : 'No earnings recorded yet.';
        chartEmpty.classList.remove('d-none');
        return;
    }
    canvas.style.display = 'block';
    chartEmpty.classList.add('d-none');

    let Chart;
    try {
        const mod = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm');
        Chart = mod.Chart;
        Chart.register(...mod.registerables);
    } catch (e) {
        loadError.textContent = 'Chart library failed to load: ' + (e.message || e);
        loadError.classList.remove('d-none');
        return;
    }

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const labels = buckets.map((b) => b.label);
    const factor = currencyFactor(); // plot in the display currency

    chartInstance = new Chart(canvas, {
        data: {
            labels,
            datasets: [
                { type: 'bar', label: 'Host Pro subscription', data: buckets.map((b) => b.sub * factor), backgroundColor: PRODUCT_COLORS.sub, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Host Pro one-time', data: buckets.map((b) => b.onetime * factor), backgroundColor: PRODUCT_COLORS.onetime, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Player Pro', data: buckets.map((b) => b.playerPro * factor), backgroundColor: PRODUCT_COLORS.playerPro, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Player Pro one-time', data: buckets.map((b) => b.stats * factor), backgroundColor: PRODUCT_COLORS.stats, stack: 'products', borderRadius: 3, order: 3 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 12, font: { size: 11 }, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${fmtDisplay(ctx.parsed.y)}`,
                        footer: (items) => `Total: ${fmtDisplay(items.reduce((sum, it) => sum + (it.parsed.y || 0), 0))}`,
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, stacked: true, ticks: { maxRotation: 0, autoSkip: true } },
                y: { beginAtZero: true, stacked: true, position: 'left', title: { display: true, text: `Per period · ${metric === 'net' ? 'est. net' : 'gross'} (${displayCurrency})`, font: { size: 10 }, color: '#94a3b8' }, ticks: { callback: (v) => fmtDisplay(v, true) } },
            },
        },
    });
}

// Renders the recent-payments list. Test/sandbox rows (sysAdmin + app-store
// reviewer accounts) are filtered out server-side, so only real purchases appear.
function renderRecent() {
    const container = document.getElementById('recent-list');
    const rows = (summary && Array.isArray(summary.recentPayments)) ? summary.recentPayments : [];
    if (!rows.length) {
        container.innerHTML = '<p class="text-muted small mb-0">No payments yet.</p>';
        return;
    }
    container.innerHTML = '';
    for (const row of rows) {
        const meta = PRODUCT_META[row.product] || { color: '#94a3b8', label: row.product };
        const el = document.createElement('div');
        el.className = 'pay-row';

        const when = document.createElement('div');
        when.className = 'pay-when';
        when.textContent = row.createdAt
            ? new Date(row.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : '';

        const product = document.createElement('div');
        product.className = 'pay-product';
        product.innerHTML = `<span class="dot" style="background:${meta.color}"></span>${escapeHtml(meta.label)}`;

        const amount = document.createElement('div');
        amount.className = 'pay-amount';
        amount.textContent = fmtMoney(row.grossUsd);

        const status = document.createElement('div');
        const statusKey = (row.status || '').toLowerCase();
        const statusClass = statusKey === 'live' ? 'live'
            : (['ended', 'cancelled', 'paused'].includes(statusKey) ? statusKey : 'other');
        status.className = 'pay-status ' + statusClass;
        status.textContent = row.status || '';

        el.appendChild(when);
        el.appendChild(product);
        el.appendChild(amount);
        el.appendChild(status);
        container.appendChild(el);
    }
}

function renderFootnote() {
    const parts = [];
    if (displayCurrency === 'CAD') {
        parts.push('Amounts converted to USD then to CAD at approximate fixed rates; net is an estimate after platform fees (Stripe ~3%, in-app purchase ~15%).');
    } else {
        parts.push('Amounts converted to USD at approximate fixed rates; net is an estimate after platform fees (Stripe ~3%, in-app purchase ~15%).');
    }
    parts.push('Days are grouped by Eastern Time. Each purchase is counted once on its purchase date; subscription renewals are not yet counted separately.');
    if (summary && Array.isArray(summary.unknownCurrencies) && summary.unknownCurrencies.length) {
        parts.push('Counted 1:1 (no FX rate on file): ' + summary.unknownCurrencies.join(', ') + '.');
    }
    if (summary && summary.unpricedCount) {
        parts.push(summary.unpricedCount + ' purchase(s) could not be priced and are excluded.');
    }
    if (summary && summary.generatedAt) {
        parts.push('As of ' + new Date(summary.generatedAt).toLocaleString() + '.');
    }
    document.getElementById('footnote').textContent = parts.join(' ');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// ----- Control toggles -----

function wireSegmented(containerId, attr, apply) {
    const container = document.getElementById(containerId);
    container.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !button.dataset[attr]) return;
        for (const sibling of container.querySelectorAll('button')) sibling.classList.remove('active');
        button.classList.add('active');
        apply(button.dataset[attr]);
        if (summary) renderAll();
    });
}

wireSegmented('metric-seg', 'metric', (value) => { metric = value; });
wireSegmented('currency-seg', 'currency', (value) => { displayCurrency = value; });
wireSegmented('grain-seg', 'grain', (value) => { grain = value; });

// Date range: preset pills plus a pair of date inputs revealed by "Custom".
(function wireDateRange() {
    const rangeSeg = document.getElementById('range-seg');
    const customRange = document.getElementById('custom-range');
    const startInput = document.getElementById('range-start');
    const endInput = document.getElementById('range-end');

    // Don't allow picking a future day (there's no data past today).
    const today = todayKeyEt();
    startInput.max = today;
    endInput.max = today;

    rangeSeg.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !button.dataset.range) return;
        for (const sibling of rangeSeg.querySelectorAll('button')) sibling.classList.remove('active');
        button.classList.add('active');
        rangePreset = button.dataset.range;
        customRange.classList.toggle('d-none', rangePreset !== 'custom');
        if (summary) renderAll();
    });

    function onCustomChange() {
        customStart = startInput.value || null;
        customEnd = endInput.value || null;
        if (rangePreset === 'custom' && summary) renderAll();
    }
    startInput.addEventListener('change', onCustomChange);
    endInput.addEventListener('change', onCustomChange);
})();

// ----- Auth gate (same pattern as the other admin pages) -----

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        showLogin();
        return;
    }
    showLoading();
    try {
        const result = await httpsCallable(functions, 'verifySysAdmin')();
        if (result.data.isSysAdmin) {
            await showAdmin(user.email);
        } else {
            loginError.textContent = 'Access denied — you are not a sysAdmin.';
            loginError.classList.remove('d-none');
            await signOut(auth);
            showLogin();
        }
    } catch (e) {
        loginError.textContent = 'Error verifying admin status: ' + e.message;
        loginError.classList.remove('d-none');
        await signOut(auth);
        showLogin();
    }
});

document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    loginError.classList.add('d-none');
    if (!email || !password) {
        loginError.textContent = 'Email and password are required.';
        loginError.classList.remove('d-none');
        return;
    }
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
        loginError.textContent = 'Sign in failed: ' + e.message;
        loginError.classList.remove('d-none');
    }
});

document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('sign-out-btn').addEventListener('click', () => signOut(auth));

refreshBtn.addEventListener('click', () => loadEarnings());
