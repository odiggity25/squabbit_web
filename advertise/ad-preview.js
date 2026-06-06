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

function renderMobile(data) {
    return `
        <div class="phone-frame">
            <div class="phone-screen">
                ${renderStatusBar()}
                ${renderAppHeader()}
                <div class="phone-feed">
                    ${renderSectionLabel('Recent groups')}
                    ${renderGroupCard('Season opener', 'Strokeplay/Matchplay', '10 players · Mar 18')}
                    ${renderAdSlot(data)}
                    ${renderSectionLabel('Squabbit Showcase', { faded: true })}
                </div>
                ${renderTabBar('home')}
            </div>
        </div>
    `;
}

function renderWeb(data) {
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
                ${renderAppHeader({ web: true })}
                <div class="web-feed">
                    ${renderSectionLabel('Recent groups')}
                    <div class="web-feed-row">
                        ${renderGroupCard('Season opener', 'Strokeplay/Matchplay', '10 players · Mar 18')}
                        ${renderGroupCard('Member-guest', 'Best ball', '8 players · Apr 12', { variant: 'green' })}
                    </div>
                    ${renderAdSlot(data, { web: true })}
                    ${renderSectionLabel('Squabbit Showcase', { faded: true })}
                </div>
            </div>
        </div>
    `;
}

/* ── Shared feed pieces ──────────────────────────────────── */

function renderStatusBar() {
    return `
        <div class="phone-statusbar">
            <span>11:04</span>
            <span class="phone-statusbar-icons">
                <span aria-hidden="true">&#9679;&#9679;&#9679;</span>
                <span aria-hidden="true">&#128246;</span>
                <span aria-hidden="true">&#128267;</span>
            </span>
        </div>
    `;
}

function renderAppHeader({ web = false } = {}) {
    return `
        <div class="phone-app-header${web ? ' web-app-header' : ''}">
            <img src="/assets/squabbit_wordmark.png" alt="Squabbit" />
        </div>
    `;
}

function renderSectionLabel(text, { faded = false } = {}) {
    return `<div class="phone-section-label${faded ? ' phone-section-label-faded' : ''}">${escapeHtml(text)}</div>`;
}

function renderGroupCard(title, sub, meta, { variant = 'sand' } = {}) {
    return `
        <div class="phone-group-card">
            <div class="phone-group-card-img phone-group-card-img-${variant}">
                <span class="phone-group-card-tag">&#127942; Tournament</span>
                <span class="phone-group-card-title">${escapeHtml(title)}</span>
            </div>
            <div class="phone-group-card-meta">
                ${escapeHtml(sub)}<br>${escapeHtml(meta)}
            </div>
        </div>
    `;
}

function renderTabBar(active = 'home') {
    const items = [
        { key: 'home', icon: '&#127968;', label: 'Home' },
        { key: 'groups', icon: '&#128101;', label: 'Groups' },
        { key: 'play', icon: '&#9971;', label: 'Play' },
        { key: 'search', icon: '&#128269;', label: 'Search' },
        { key: 'profile', icon: '&#128100;', label: 'Profile' },
    ];
    return `
        <div class="phone-tabs">
            ${items.map((i) => `
                <span class="${active === i.key ? 'phone-tab-active' : ''}">
                    <span class="phone-tab-icon">${i.icon}</span>
                    ${escapeHtml(i.label)}
                </span>
            `).join('')}
        </div>
    `;
}

function renderAdSlot(data, { web = false } = {}) {
    const { companyName, title, body, imageUrl, videoUrl } = data;
    const hasVideo = !!videoUrl;
    const hasImage = !!imageUrl;
    const hasCompany = !!(companyName && companyName.trim());
    const hasTitle = !!(title && title.trim());
    const hasBody = !!(body && body.trim());
    const safeCompany = escapeHtml((companyName || '').toUpperCase());
    const safeTitle = escapeHtml(title || 'Your headline goes here');
    const safeBody = escapeHtml(body || 'A short blurb describing what you offer to Squabbit golfers.');
    const showContent = hasCompany || hasTitle || hasBody || (!title && !body);

    return `
        <div class="${web ? 'web-ad-slot' : 'mobile-ad-slot'}">
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
                </div>
                ${showContent ? `
                    <div class="mobile-ad-content">
                        ${hasCompany ? `<div class="mobile-ad-company">${safeCompany}</div>` : ''}
                        ${hasTitle || (!title && !body) ? `<div class="mobile-ad-title">${safeTitle}</div>` : ''}
                        ${hasBody || (!title && !body) ? `<div class="mobile-ad-body">${safeBody}</div>` : ''}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}
