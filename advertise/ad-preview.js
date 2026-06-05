// Renders previews of how the ad will appear. Two modes:
//   - mobile: pixel-faithful to the Flutter AdFeedWidget — "Promoted" header
//     above a 16:9 card with white background, 12px radius, title overlaid on
//     a black-to-transparent gradient at the bottom of the media, body text
//     below in a 12px padding block. Max width 500dp, presented inside a
//     simulated feed surface.
//   - web: a polished branded card variant for desktop/web placements (brand
//     eyebrow, title, body, CTA button).

import { escapeHtml } from '/advertise/shared.js';

let currentMode = 'mobile';
let lastTarget = null;
let lastData = null;

export function renderPreview(target, data) {
    lastTarget = target;
    lastData = data;
    if (!target.querySelector('.preview-frame')) {
        target.innerHTML = `
            <div class="preview-frame">
                <div class="preview-toggle" role="tablist" aria-label="Preview mode">
                    <button type="button" data-mode="mobile" role="tab">
                        <span class="preview-toggle-icon">&#9742;</span>
                        Mobile
                    </button>
                    <button type="button" data-mode="web" role="tab">
                        <span class="preview-toggle-icon">&#9744;</span>
                        Web
                    </button>
                </div>
                <div class="preview-stage" id="preview-stage"></div>
            </div>
        `;
        target.querySelectorAll('.preview-toggle button').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (currentMode === btn.dataset.mode) return;
                currentMode = btn.dataset.mode;
                updateToggle();
                renderStage();
            });
        });
    }
    updateToggle();
    renderStage();
}

function updateToggle() {
    if (!lastTarget) return;
    lastTarget.querySelectorAll('.preview-toggle button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
        btn.setAttribute('aria-selected', btn.dataset.mode === currentMode ? 'true' : 'false');
    });
}

function renderStage() {
    if (!lastTarget) return;
    const stage = lastTarget.querySelector('#preview-stage');
    stage.innerHTML = currentMode === 'mobile' ? renderMobile(lastData) : renderWeb(lastData);
}

function renderMobile({ title, body, imageUrl, videoUrl }) {
    const hasVideo = !!videoUrl;
    const hasImage = !!imageUrl;
    const safeTitle = escapeHtml(title || 'Your headline goes here');
    const safeBody = escapeHtml(body || 'A short blurb describing what you offer to Squabbit golfers.');
    const hasTitle = !!(title && title.trim());

    return `
        <div class="mobile-stage">
            <div class="mobile-stage-inner">
                <div class="mobile-promoted-header">
                    <span>Promoted</span>
                    <span class="mobile-dots" aria-hidden="true">&#x22EE;</span>
                </div>
                <div class="mobile-ad-card">
                    <div class="mobile-ad-media">
                        ${hasVideo
                            ? `<video src="${escapeHtml(videoUrl)}" muted autoplay loop playsinline poster="${escapeHtml(imageUrl || '')}"></video>`
                            : hasImage
                                ? `<img src="${escapeHtml(imageUrl)}" alt="" onerror="this.style.visibility='hidden'" />`
                                : `<div class="mobile-ad-media-placeholder">Your image (16:9)</div>`
                        }
                        ${hasTitle || (!title && !body) ? `
                            <div class="mobile-ad-gradient"></div>
                            <div class="mobile-ad-title">${safeTitle}</div>
                        ` : ''}
                    </div>
                    ${body || !title ? `<div class="mobile-ad-body">${safeBody}</div>` : ''}
                </div>
            </div>
        </div>
    `;
}

function renderWeb({ title, body, url, imageUrl, videoUrl, brandName }) {
    const hasVideo = !!videoUrl;
    const hasImage = !!imageUrl;
    const safeBrand = escapeHtml(brandName || 'Your brand');
    const safeTitle = escapeHtml(title || 'Your headline goes here');
    const safeBody = escapeHtml(body || 'A short blurb describing what you offer to Squabbit golfers.');
    const cta = hostnameLabel(url) || 'Learn more';

    return `
        <div class="web-stage">
            <div class="web-ad-card">
                <div class="web-ad-media">
                    ${hasVideo
                        ? `<video src="${escapeHtml(videoUrl)}" muted autoplay loop playsinline poster="${escapeHtml(imageUrl || '')}"></video>`
                        : hasImage
                            ? `<img src="${escapeHtml(imageUrl)}" alt="" onerror="this.style.visibility='hidden'" />`
                            : `<div class="web-ad-media-placeholder">Your image (16:9)</div>`
                    }
                </div>
                <div class="web-ad-content">
                    <div class="web-ad-brand">${safeBrand}</div>
                    <div class="web-ad-title">${safeTitle}</div>
                    <div class="web-ad-body">${safeBody}</div>
                    <div class="web-ad-cta">
                        <span>${escapeHtml(cta)}</span>
                        <span class="web-ad-arrow">&rarr;</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function hostnameLabel(url) {
    if (!url) return null;
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.replace(/^www\./, '');
    } catch (_) {
        return null;
    }
}
