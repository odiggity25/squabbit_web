// Daily performance chart for the advertiser portal. Chart.js is loaded from a CDN
// on demand (ESM) so the rest of the portal stays dependency-free. Renders Views
// (total) and Unique views on the left axis, Clicks on the right, with go-live /
// ended marker lines and shaded paused spans drawn by a small inline plugin.

let chartInstance = null;

function toKey(d) {
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

export async function renderAdChart(canvas, { series, goLive, endDate, pausedSpans = [], now }) {
    let Chart;
    try {
        const mod = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm');
        Chart = mod.Chart;
        Chart.register(...mod.registerables);
    } catch (e) {
        throw new Error(`chart library failed to load: ${e.message}`);
    }

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const labels = series.map((s) => s.date);

    // Draws shaded paused spans and dashed go-live / ended marker lines, mapping each
    // date to its category pixel. Markers whose day falls outside the data are skipped.
    const markerPlugin = {
        id: 'adMarkers',
        afterDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            const x = scales.x;
            const { top, bottom } = chartArea;
            ctx.save();
            for (const sp of pausedSpans) {
                const x1 = x.getPixelForValue(toKey(sp.from));
                const x2 = x.getPixelForValue(toKey(sp.to));
                if (Number.isFinite(x1) && Number.isFinite(x2)) {
                    ctx.fillStyle = 'rgba(148,163,184,0.18)';
                    ctx.fillRect(Math.min(x1, x2), top, Math.max(2, Math.abs(x2 - x1)), bottom - top);
                }
            }
            const lines = [];
            if (goLive) lines.push({ key: toKey(goLive), label: 'Live', color: '#1E7A4A' });
            if (endDate && now > endDate) lines.push({ key: toKey(endDate), label: 'Ended', color: '#94a3b8' });
            for (const ln of lines) {
                const px = x.getPixelForValue(ln.key);
                if (!Number.isFinite(px)) continue;
                ctx.strokeStyle = ln.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(px, top);
                ctx.lineTo(px, bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = ln.color;
                ctx.font = '600 10px Outfit, system-ui, sans-serif';
                ctx.fillText(ln.label, px + 3, top + 10);
            }
            ctx.restore();
        },
    };

    chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Views', data: series.map((s) => s.impressions), borderColor: '#2D9D5F', backgroundColor: 'rgba(45,157,95,0.12)', fill: true, tension: 0.25, yAxisID: 'y', pointRadius: 2 },
                { label: 'Unique', data: series.map((s) => s.uniqueViews), borderColor: '#1A5C3A', backgroundColor: 'transparent', tension: 0.25, yAxisID: 'y', pointRadius: 2 },
                { label: 'Clicks', data: series.map((s) => s.clicks), borderColor: '#1d4ed8', backgroundColor: 'transparent', tension: 0.25, yAxisID: 'y1', pointRadius: 2 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 12, font: { size: 11 } } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        callback(value) {
                            const lbl = labels[value] || '';
                            const d = new Date(`${lbl}T00:00:00Z`);
                            return Number.isNaN(d.getTime()) ? lbl : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                        },
                    },
                },
                y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Views' } },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Clicks' } },
            },
        },
        plugins: [markerPlugin],
    });
}
