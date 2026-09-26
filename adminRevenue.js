import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

// Same Firebase config + modular SDK (v11.0.1) as the other admin pages. This
// page is a sysAdmin-only revenue dashboard for the monetization ledger plus
// advertiser wallet top-ups; all aggregation happens in the `getRevenueSummary`
// callable (the ledger is otherwise read-your-own-only), and this page just
// renders the result.
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

const PRODUCT_COLORS = { sub: '#C8A035', onetime: '#1E7A4A', playerPro: '#7C3AED', leaguePro: '#0D9488', stats: '#2563EB', txnFee: '#C4622D', ad: '#DB2777' };

// Server product key -> web color / label, for the recent-payments rows.
const PRODUCT_META = {
    sub: { color: PRODUCT_COLORS.sub, label: 'Host Pro subscription' },
    oneTime: { color: PRODUCT_COLORS.onetime, label: 'Host Pro one-time' },
    playerPro: { color: PRODUCT_COLORS.playerPro, label: 'Player Pro' },
    leaguePro: { color: PRODUCT_COLORS.leaguePro, label: 'League Pro' },
    stats: { color: PRODUCT_COLORS.stats, label: 'Player Pro one-time' },
    txnFee: { color: PRODUCT_COLORS.txnFee, label: 'Transaction fee (2%)' },
    ad: { color: PRODUCT_COLORS.ad, label: 'Ad revenue' },
};
const loginSection = document.getElementById('login-section');
const adminContent = document.getElementById('admin-content');
const loading = document.getElementById('loading');
const loginError = document.getElementById('login-error');
const signedInAs = document.getElementById('signed-in-as');
const loadError = document.getElementById('load-error');
const refreshBtn = document.getElementById('refresh-btn');
const revenueLoading = document.getElementById('revenue-loading');
const revenueBody = document.getElementById('revenue-body');

// The full response from getRevenueSummary. Toggles re-render from this with no
// refetch (the daily series is rolled up to the chosen granularity client-side).
let summary = null;
let metric = 'gross';        // 'gross' | 'net'
let grain = 'daily';         // 'daily' | 'weekly' | 'monthly'
let displayCurrency = 'CAD'; // 'USD' | 'CAD'
// Date range filter. Presets are rolling windows ending today (Eastern Time);
// 'all' shows the full history. Data is day-granular, so 'today' is the current
// ET day so far. Custom uses the two date inputs (either bound optional).
let rangePreset = 'today';   // 'all' | 'today' | 'yesterday' | '7d' | '30d' | '365d' | 'custom'
let customStart = null;      // 'YYYY-MM-DD' or null
let customEnd = null;        // 'YYYY-MM-DD' or null
let chartInstance = null;

// Transactions list. The server scopes it to the active date range and returns
// up to `recentLimit` rows, newest first; "Show more" bumps the limit and
// refetches. recentHasMore is the server's signal that more rows exist beyond
// what was returned.
let transactions = [];       // the scoped rows currently loaded
let recentLimit = 25;        // rows to request; grows by a page on "Show more"
let recentHasMore = false;   // server says more rows exist past recentLimit
let loadingMore = false;     // a "Show more" fetch is in flight

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
    await loadRevenue();
}

// Fetch the latest revenue summary. The dashboard no longer auto-updates; the
// admin refreshes on demand with the Refresh button.
// Fetch the revenue summary, scoping the transactions list to the active date
// range and the current row limit. `rerender: 'transactions'` (used by "Show
// more") re-renders only the list, leaving the chart/headline untouched so they
// don't rebuild when the underlying totals haven't changed.
async function loadRevenue(options = {}) {
    const transactionsOnly = options.rerender === 'transactions';
    loadError.classList.add('d-none');
    if (!transactionsOnly) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing…';
    }
    try {
        const range = activeRange();
        const result = await httpsCallable(functions, 'getRevenueSummary')({
            recentStart: range ? range.start : null,
            recentEnd: range ? range.end : null,
            recentLimit,
        });
        summary = result.data;
        transactions = Array.isArray(summary.recentPayments) ? summary.recentPayments : [];
        recentHasMore = !!summary.recentHasMore;
        if (transactionsOnly) renderTransactions();
        else renderAll();
        // First successful load: swap the spinner out for the real content.
        // On later refreshes both of these are already in their final state.
        revenueLoading.classList.add('d-none');
        revenueBody.classList.remove('d-none');
    } catch (e) {
        loadError.textContent = 'Could not load revenue: ' + (e.message || e);
        loadError.classList.remove('d-none');
        // Drop the spinner so a failed first load shows only the error, not a
        // stuck loader. Any already-rendered content stays put on a refresh.
        revenueLoading.classList.add('d-none');
    } finally {
        if (!transactionsOnly) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        }
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

// Whole days between two 'YYYY-MM-DD' keys, inclusive of both ends.
function daysInclusive(startKey, endKey) {
    const ms = parseDay(endKey) - parseDay(startKey);
    return Math.round(ms / 86400000) + 1;
}

// Calendar span of the current view, in days. For a custom range this is the
// chosen start→end; for all time it's the first day with data through the last.
// Used to give open-ended views a sense of scale.
function visibleDayCount() {
    const days = filteredDaily();
    if (!days.length) return 0;
    let startKey = days[0].day;
    let endKey = days[days.length - 1].day;
    const range = activeRange();
    if (range) {
        if (range.start && range.start !== '0000-01-01') startKey = range.start;
        if (range.end) endKey = range.end;
    }
    return daysInclusive(startKey, endKey);
}

// The inclusive day-key range a chart bucket covers, per the current
// granularity: a single day (daily), its Monday-through-Sunday week (weekly),
// or its whole calendar month (monthly). Clamped so the end never runs past
// today, since there's no data beyond it.
function bucketRange(bucket) {
    const today = todayKeyEt();
    let start;
    let end;
    if (grain === 'weekly') {
        start = bucket.key;
        const endDate = parseDay(bucket.key);
        endDate.setUTCDate(endDate.getUTCDate() + 6);
        end = endDate.toISOString().slice(0, 10);
    } else if (grain === 'monthly') {
        start = bucket.key + '-01';
        const first = parseDay(start);
        end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    } else {
        start = bucket.key;
        end = bucket.key;
    }
    if (end > today) end = today;
    return { start, end };
}

// Switch the dashboard to a custom range and reflect it in the controls (active
// pill, revealed inputs, filled-in dates), then reload. Used when a chart bar is
// tapped, so the range jumps to that bar without hand-picking dates.
function applyCustomRange(start, end) {
    rangePreset = 'custom';
    customStart = start;
    customEnd = end;
    const rangeSeg = document.getElementById('range-seg');
    for (const button of rangeSeg.querySelectorAll('button')) {
        button.classList.toggle('active', button.dataset.range === 'custom');
    }
    document.getElementById('custom-range').classList.remove('d-none');
    document.getElementById('range-start').value = start;
    document.getElementById('range-end').value = end;
    recentLimit = 25;
    if (summary) loadRevenue();
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
            bucket = { key, label, sub: 0, onetime: 0, playerPro: 0, leaguePro: 0, stats: 0, txnFee: 0, ad: 0, count: 0 };
            buckets.set(key, bucket);
        }
        bucket.sub += values.sub || 0;
        bucket.onetime += values.oneTime || 0;
        bucket.playerPro += values.playerPro || 0;
        bucket.leaguePro += values.leaguePro || 0;
        bucket.stats += values.stats || 0;
        bucket.txnFee += values.txnFee || 0;
        bucket.ad += values.ad || 0;
        bucket.count += day.count || 0;
    }
    return [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ----- Render -----

function renderAll() {
    renderHeadline();
    renderChart(rollup());
    renderTransactions();
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
        sub: { gross: 0, net: 0, count: 0 },
        oneTime: { gross: 0, net: 0, count: 0 },
        playerPro: { gross: 0, net: 0, count: 0 },
        leaguePro: { gross: 0, net: 0, count: 0 },
        stats: { gross: 0, net: 0, count: 0 },
        txnFee: { gross: 0, net: 0, count: 0 },
        ad: { gross: 0, net: 0, count: 0 },
    };
    let gross = 0, net = 0, count = 0;
    for (const day of filteredDaily()) {
        for (const p of ['sub', 'oneTime', 'playerPro', 'leaguePro', 'stats', 'txnFee', 'ad']) {
            const g = (day.gross && day.gross[p]) || 0;
            const n = (day.net && day.net[p]) || 0;
            byProduct[p].gross += g;
            byProduct[p].net += n;
            byProduct[p].count += (day.counts && day.counts[p]) || 0;
            gross += g;
            net += n;
        }
        count += day.count || 0;
    }
    // The server now sends per-product counts per day, so a range can show them.
    return { totals: { gross, net, count, byProduct }, hasProductCounts: true };
}

function renderHeadline() {
    const { totals, hasProductCounts } = viewTotals();
    const byProduct = totals.byProduct || {};
    const heroValue = metric === 'net' ? totals.net : totals.gross;
    const otherValue = metric === 'net' ? totals.gross : totals.net;
    const otherLabel = metric === 'net' ? 'gross' : 'est. net';

    document.getElementById('hero-label').textContent = metric === 'net' ? 'Estimated net' : 'Total gross';
    document.getElementById('hero-amount').innerHTML = accentedAmount(heroValue);
    // Recurring revenue = the subscription products (Host Pro subscription +
    // Player Pro + League Pro), for the active metric. This is subscription revenue
    // booked to date, not active MRR — renewals aren't counted separately yet (see
    // footnote).
    const subBucket = byProduct.sub || {};
    const playerProBucket = byProduct.playerPro || {};
    const leagueProBucket = byProduct.leaguePro || {};
    const recurringValue = metric === 'net'
        ? (subBucket.net || 0) + (playerProBucket.net || 0) + (leagueProBucket.net || 0)
        : (subBucket.gross || 0) + (playerProBucket.gross || 0) + (leagueProBucket.gross || 0);
    const recurringEl = document.getElementById('hero-recurring');

    const daysEl = document.getElementById('hero-days');
    if (totals.count > 0) {
        document.getElementById('hero-subline').textContent =
            `${totals.count} ${totals.count === 1 ? 'transaction' : 'transactions'} · ${otherLabel} ${fmtMoney(otherValue)}`;
        recurringEl.innerHTML =
            `<span class="dot"></span>Recurring <strong>${escapeHtml(fmtMoney(recurringValue))}</strong> · Host Pro + Player Pro + League Pro`;
        recurringEl.style.display = '';
        // The day span sits on its own line, and only for the open-ended views
        // (all time / custom) where it isn't obvious from the preset.
        let daysText = '';
        if (rangePreset === 'all' || rangePreset === 'custom') {
            const days = visibleDayCount();
            if (days > 0) daysText = `over ${days} ${days === 1 ? 'day' : 'days'}`;
        }
        daysEl.textContent = daysText;
        daysEl.style.display = daysText ? '' : 'none';
    } else {
        document.getElementById('hero-subline').textContent = 'No revenue yet';
        recurringEl.style.display = 'none';
        daysEl.textContent = '';
        daysEl.style.display = 'none';
    }

    setProductCard('sub', byProduct.sub, hasProductCounts);
    setProductCard('onetime', byProduct.oneTime, hasProductCounts);
    setProductCard('playerPro', byProduct.playerPro, hasProductCounts);
    setProductCard('leaguePro', byProduct.leaguePro, hasProductCounts);
    setProductCard('stats', byProduct.stats, hasProductCounts);
    // Fees are collected on payments, not sold as purchases, so they count in
    // their own noun.
    setProductCard('txnFee', byProduct.txnFee, hasProductCounts, 'payment');
    // Ad revenue is a count of advertiser wallet top-ups, also a payment.
    setProductCard('ad', byProduct.ad, hasProductCounts, 'payment');
}

function setProductCard(id, product, hasCount, noun = 'purchase') {
    const bucket = product || { gross: 0, net: 0, count: 0 };
    const value = metric === 'net' ? bucket.net : bucket.gross;
    document.getElementById(`card-${id}-val`).textContent = fmtMoney(value);
    const count = bucket.count || 0;
    // Per-product counts aren't available for a date range, so leave the meta
    // blank there rather than show a wrong number.
    document.getElementById(`card-${id}-meta`).textContent = hasCount
        ? `${count} ${count === 1 ? noun : noun + 's'}`
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
    const canvas = document.getElementById('revenue-chart');
    if (!buckets.length) {
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        canvas.style.display = 'none';
        chartEmpty.textContent = activeRange() ? 'No revenue in this date range.' : 'No revenue recorded yet.';
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
    // Weekday name per bar, only for the daily view (weekly buckets are always a
    // Monday, monthly buckets span many days, so a weekday is meaningless there).
    const weekdays = grain === 'daily'
        ? buckets.map((b) => parseDay(b.key).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }))
        : null;
    const factor = currencyFactor(); // plot in the display currency

    chartInstance = new Chart(canvas, {
        data: {
            labels,
            datasets: [
                { type: 'bar', label: 'Host Pro subscription', data: buckets.map((b) => b.sub * factor), backgroundColor: PRODUCT_COLORS.sub, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Host Pro one-time', data: buckets.map((b) => b.onetime * factor), backgroundColor: PRODUCT_COLORS.onetime, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Player Pro', data: buckets.map((b) => b.playerPro * factor), backgroundColor: PRODUCT_COLORS.playerPro, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Player Pro one-time', data: buckets.map((b) => b.stats * factor), backgroundColor: PRODUCT_COLORS.stats, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'League Pro', data: buckets.map((b) => b.leaguePro * factor), backgroundColor: PRODUCT_COLORS.leaguePro, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Transaction fees', data: buckets.map((b) => b.txnFee * factor), backgroundColor: PRODUCT_COLORS.txnFee, stack: 'products', borderRadius: 3, order: 3 },
                { type: 'bar', label: 'Ad revenue', data: buckets.map((b) => b.ad * factor), backgroundColor: PRODUCT_COLORS.ad, stack: 'products', borderRadius: 3, order: 3 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            // Tap a bar to jump the date range to that day/week/month, so you can
            // drill in without hand-picking dates. The cursor becomes a pointer
            // over bars to signal they're clickable.
            onClick: (event, elements) => {
                if (!elements || !elements.length) return;
                const bucket = buckets[elements[0].index];
                if (!bucket) return;
                const { start, end } = bucketRange(bucket);
                applyCustomRange(start, end);
            },
            onHover: (event, elements) => {
                const target = event && event.native && event.native.target;
                if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            plugins: {
                legend: { labels: { boxWidth: 12, font: { size: 11 }, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const label = items[0].label;
                            if (!weekdays) return label;
                            return `${label} · ${weekdays[items[0].dataIndex]}`;
                        },
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

// Renders the transactions list, already scoped by the server to the active
// date range and newest-first. Test/sandbox rows (sysAdmin + app-store reviewer
// accounts) are filtered out server-side, so only real purchases appear. Shows
// the "Show more" button when the server reports more rows past what's loaded.
function renderTransactions() {
    const container = document.getElementById('recent-list');
    const showMoreBtn = document.getElementById('show-more-btn');
    const rows = transactions;
    if (!rows.length) {
        container.innerHTML = `<p class="text-muted small mb-0">${activeRange() ? 'No transactions in this date range.' : 'No transactions yet.'}</p>`;
        showMoreBtn.classList.add('d-none');
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
    showMoreBtn.classList.toggle('d-none', !recentHasMore);
    if (!loadingMore) {
        showMoreBtn.disabled = false;
        showMoreBtn.textContent = 'Show more';
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
    parts.push('Tier upgrades and partial refunds are approximate: in-app purchases are valued at list price (the stores don’t report the actual charge, so an upgrade credit isn’t netted out), and a lower tier replaced by an upgrade is dropped rather than counted on top of the new tier.');
    parts.push('Transaction fees are Squabbit’s 2% cut on confirmed event payments, counted at full value (Stripe’s processing fee is charged to the host, not this cut). Fees are tracked from launch, so earlier dates show none.');
    parts.push('Ad revenue is money advertisers pre-pay into their wallet to run ads, counted in full on the day the payment clears (not as impressions deliver). Test top-ups and internal advertiser accounts are excluded.');
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
        // A new range means a new transactions scope, so start its paging over
        // and refetch (the list is scoped server-side).
        recentLimit = 25;
        if (summary) loadRevenue();
    });

    function onCustomChange() {
        customStart = startInput.value || null;
        customEnd = endInput.value || null;
        recentLimit = 25;
        if (rangePreset === 'custom' && summary) loadRevenue();
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

refreshBtn.addEventListener('click', () => loadRevenue());

// "Show more" pulls the next page of transactions for the current range by
// bumping the row limit and refetching just the list.
document.getElementById('show-more-btn').addEventListener('click', async () => {
    if (loadingMore) return;
    loadingMore = true;
    recentLimit += 25;
    const showMoreBtn = document.getElementById('show-more-btn');
    showMoreBtn.disabled = true;
    showMoreBtn.textContent = 'Loading…';
    try {
        await loadRevenue({ rerender: 'transactions' });
    } finally {
        loadingMore = false;
        showMoreBtn.disabled = false;
        showMoreBtn.textContent = 'Show more';
    }
});
