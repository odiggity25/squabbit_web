// Renders previews of how the ad will appear in the Flutter app.
// The widget is the same on both platforms (lib/feed/AdFeedWidget.dart) and
// constrained to maxWidth: 500. What differs is the surrounding viewport:
//   - mobile: narrow phone-shaped feed surface, app.squabbitgolf.com on iOS/Android
//   - web: desktop browser chrome at app.squabbitgolf.com, same ad card
//     centered with more whitespace around it

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

function renderWeb({ title, body, imageUrl, videoUrl }) {
    const hasVideo = !!videoUrl;
    const hasImage = !!imageUrl;
    const safeTitle = escapeHtml(title || 'Your headline goes here');
    const safeBody = escapeHtml(body || 'A short blurb describing what you offer to Squabbit golfers.');
    const hasTitle = !!(title && title.trim());

    return `
        <div class="web-stage">
            <div class="browser-chrome">
                <div class="browser-controls">
                    <span class="browser-dot browser-dot-red"></span>
                    <span class="browser-dot browser-dot-yellow"></span>
                    <span class="browser-dot browser-dot-green"></span>
                </div>
                <div class="browser-address">
                    <span class="browser-lock" aria-hidden="true">&#128274;</span>
                    app.squabbitgolf.com
                </div>
                <div class="browser-spacer"></div>
            </div>
            <div class="web-viewport">
                <div class="web-ad-wrap">
                    <div class="mobile-promoted-header">
                        <span>Promoted</span>
                        <span class="mobile-dots" aria-hidden="true">&#x22EE;</span>
                    </div>
                    <div class="mobile-ad-card web-ad-card">
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
        </div>
    `;
}
