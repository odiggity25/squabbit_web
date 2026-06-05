// Renders the advertiser's preview of how the ad will look in the app. Visual
// fidelity is intentionally close-but-not-pixel-perfect for the MVP. The
// frontend-design polish step matches the Flutter ad card more precisely.

import { escapeHtml } from '/advertise/shared.js';

export function renderPreview(target, { title, body, url, imageUrl, videoUrl, brandName }) {
    const hasVideo = !!videoUrl;
    const hasImage = !!imageUrl;
    const safeBrand = escapeHtml(brandName || 'Your brand');
    const safeTitle = escapeHtml(title || 'Your headline');
    const safeBody = escapeHtml(body || 'A short blurb describing what you offer to Squabbit golfers.');
    const callToAction = hostnameLabel(url) || 'Learn more';

    target.innerHTML = `
        <div class="preview-frame">
            <div class="preview-label">In-app preview</div>
            <div class="preview-card">
                <div class="preview-media">
                    ${hasVideo
                        ? `<video src="${escapeHtml(videoUrl)}" muted autoplay loop playsinline></video>`
                        : hasImage
                            ? `<img src="${escapeHtml(imageUrl)}" alt="" onerror="this.style.visibility='hidden'" />`
                            : `<div class="preview-media-placeholder">Image will appear here</div>`
                    }
                </div>
                <div class="preview-content">
                    <div class="preview-brand">${safeBrand}</div>
                    <div class="preview-title">${safeTitle}</div>
                    <div class="preview-body">${safeBody}</div>
                    <div class="preview-cta">
                        <span>${escapeHtml(callToAction)}</span>
                        <span class="preview-arrow">&rarr;</span>
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
