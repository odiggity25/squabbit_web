import {
    auth,
    db,
    requireSignedIn,
    signInWithEmail,
    signInWithGoogle,
    signInWithApple,
    signOutUser,
    saveAdvertiser,
    escapeHtml,
    formatDate,
} from '/advertise/shared.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const loadingEl = document.getElementById('loading');
const signedOutEl = document.getElementById('signed-out-view');
const signedInEl = document.getElementById('signed-in-view');
const profileSetupEl = document.getElementById('profile-setup-view');
const dashboardEl = document.getElementById('dashboard-view');
const loginError = document.getElementById('login-error');
const profileError = document.getElementById('profile-error');

function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('d-none');
}

function clearLoginError() {
    loginError.classList.add('d-none');
}

function showProfileError(msg) {
    profileError.textContent = msg;
    profileError.classList.remove('d-none');
}

document.getElementById('login-email-btn').addEventListener('click', async () => {
    clearLoginError();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { showLoginError('Email and password are required.'); return; }
    try {
        await signInWithEmail(email, password);
    } catch (e) {
        showLoginError(e.message || 'Sign-in failed.');
    }
});

document.getElementById('login-google-btn').addEventListener('click', async () => {
    clearLoginError();
    try {
        await signInWithGoogle();
    } catch (e) {
        showLoginError(e.message || 'Google sign-in failed.');
    }
});

document.getElementById('login-apple-btn').addEventListener('click', async () => {
    clearLoginError();
    try {
        await signInWithApple();
    } catch (e) {
        showLoginError(e.message || 'Apple sign-in failed.');
    }
});

document.getElementById('sign-out-btn').addEventListener('click', () => signOutUser());

document.getElementById('profile-save-btn').addEventListener('click', async () => {
    const brandName = document.getElementById('profile-brand').value.trim();
    const contactEmail = document.getElementById('profile-email').value.trim();
    const website = document.getElementById('profile-website').value.trim();
    if (!brandName) { showProfileError('Brand name is required.'); return; }
    if (!contactEmail) { showProfileError('Contact email is required.'); return; }
    const btn = document.getElementById('profile-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await saveAdvertiser(auth.currentUser.uid, { brandName, contactEmail, website });
        window.location.reload();
    } catch (e) {
        showProfileError(e.message || 'Could not save profile.');
        btn.disabled = false;
        btn.textContent = 'Save and continue';
    }
});

const viewAsUid = new URLSearchParams(window.location.search).get('viewAs');

requireSignedIn(async (user, advertiser) => {
    loadingEl.style.display = 'none';
    if (!user) {
        signedOutEl.style.display = 'block';
        signedInEl.style.display = 'none';
        return;
    }
    signedOutEl.style.display = 'none';
    signedInEl.style.display = 'block';

    // Admin preview mode: render the dashboard as the target advertiser would see
    // it. Read access to the advertiser profile is gated by isMeAdmin() in the
    // rules, so non-admins hitting this URL will silently fall through to their
    // own profile.
    if (viewAsUid) {
        try {
            const { getAdvertiser } = await import('/advertise/shared.js');
            const targetAdvertiser = await getAdvertiser(viewAsUid);
            if (targetAdvertiser) {
                profileSetupEl.style.display = 'none';
                dashboardEl.style.display = 'block';
                renderAdminPreviewChrome(targetAdvertiser);
                await renderDashboard({ uid: viewAsUid }, targetAdvertiser, { readOnly: true });
                return;
            }
        } catch (e) {
            console.warn('viewAs lookup failed:', e);
        }
        // Fall through to normal mode if viewAs lookup fails.
    }

    if (!advertiser) {
        profileSetupEl.style.display = 'block';
        dashboardEl.style.display = 'none';
        document.getElementById('profile-email').value = user.email || '';
        return;
    }

    profileSetupEl.style.display = 'none';
    dashboardEl.style.display = 'block';
    document.getElementById('dashboard-brand-name').textContent = advertiser.brandName;
    await renderDashboard(user, advertiser);
});

function renderAdminPreviewChrome(targetAdvertiser) {
    document.getElementById('dashboard-brand-name').textContent = targetAdvertiser.brandName;
    // Swap header chrome: hide "+ New ad", replace sign-out with "Back to admin".
    const newAdBtn = document.querySelector('a[href="/advertise/ad.html"]');
    if (newAdBtn) newAdBtn.style.display = 'none';
    const signOutBtn = document.getElementById('sign-out-btn');
    if (signOutBtn) {
        signOutBtn.textContent = '← Back to admin';
        signOutBtn.onclick = (e) => { e.preventDefault(); window.location.href = '/admin.html'; };
    }
    // Banner.
    const dash = document.getElementById('dashboard-view');
    const existing = document.getElementById('admin-preview-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'admin-preview-banner';
    banner.className = 'admin-preview-banner';
    banner.innerHTML = `<strong>Admin preview</strong> &middot; Viewing as ${escapeHtml(targetAdvertiser.brandName)}. Click any ad to inspect its creative.`;
    dash.insertBefore(banner, dash.firstChild);
}

async function renderDashboard(user, advertiser, { readOnly = false } = {}) {
    const listEl = document.getElementById('ad-list');
    listEl.innerHTML = '<p class="text-muted small">Loading ads...</p>';
    try {
        const q = query(collection(db, 'ads'), where('ownerId', '==', user.uid));
        const snap = await getDocs(q);
        if (snap.empty) {
            listEl.innerHTML = renderEmptyState();
            return;
        }
        const ads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const groups = groupAdsByDisplayStatus(ads);
        listEl.innerHTML = renderGroups(groups, { readOnly });
    } catch (e) {
        listEl.innerHTML = `<p class="text-danger small">Error loading ads: ${escapeHtml(e.message)}</p>`;
    }
}

function renderEmptyState() {
    return `
        <div class="empty-state">
            <h3>Create your first ad</h3>
            <p class="text-muted">Build creative, submit for review, and watch it run.</p>
            <a href="/advertise/ad.html" class="btn btn-primary">+ New ad</a>
        </div>
    `;
}

function groupAdsByDisplayStatus(ads) {
    const now = new Date();
    const buckets = { live: [], pending: [], drafts: [], rejected: [], ended: [] };
    for (const ad of ads) {
        if (ad.status === 'pending') { buckets.pending.push(ad); continue; }
        if (ad.status === 'rejected') { buckets.rejected.push(ad); continue; }
        if (ad.status === 'draft' || !ad.status) {
            // Ads with no status (legacy/admin-created) shouldn't appear here because they
            // wouldn't have ownerId set, but guard anyway: treat unknown as drafts.
            buckets.drafts.push(ad);
            continue;
        }
        // status === 'approved'
        const start = ad.startDate?.toDate ? ad.startDate.toDate() : null;
        const end = ad.endDate?.toDate ? ad.endDate.toDate() : null;
        if (end && now > end) { buckets.ended.push(ad); continue; }
        if (start && end && now >= start && now <= end && ad.active !== false) {
            buckets.live.push(ad);
        } else {
            // Approved but not in run window yet (or active=false): show in live bucket
            // as "scheduled" — keeps it visible without a separate group for MVP.
            buckets.live.push(ad);
        }
    }
    return buckets;
}

function renderGroups(groups, { readOnly = false } = {}) {
    const sections = [
        { key: 'live', title: 'Live & scheduled', pill: 'success' },
        { key: 'pending', title: 'Pending review', pill: 'warning' },
        { key: 'drafts', title: 'Drafts', pill: 'secondary' },
        { key: 'rejected', title: 'Needs changes', pill: 'danger' },
        { key: 'ended', title: 'Ended', pill: 'secondary' },
    ];
    return sections
        .filter((s) => groups[s.key].length > 0)
        .map((s) => `
            <section class="ad-group">
                <h5 class="ad-group-title">${s.title} <span class="badge bg-${s.pill}">${groups[s.key].length}</span></h5>
                <div class="ad-group-list">
                    ${groups[s.key].map((ad) => renderAdCard(ad, readOnly)).join('')}
                </div>
            </section>
        `)
        .join('');
}

function renderAdCard(ad, readOnly = false) {
    const start = formatDate(ad.startDate);
    const end = formatDate(ad.endDate);
    const window = start && end ? `${start} – ${end}` : (ad.status === 'pending' ? 'Awaiting approval' : 'Not scheduled');
    const impressions = ad.impressions ?? 0;
    const uniqueViews = ad.uniqueViews ?? 0;
    const clicks = ad.clicks ?? 0;
    const dismissals = ad.dismissals ?? 0;
    const ctr = impressions > 0 ? `${((clicks / impressions) * 100).toFixed(1)}%` : '—';
    const href = readOnly
        ? `/advertise/ad.html?id=${encodeURIComponent(ad.id)}&viewAs=${encodeURIComponent(viewAsUid)}`
        : `/advertise/ad.html?id=${encodeURIComponent(ad.id)}`;
    return `
        <a class="ad-card" href="${href}">
            <img class="ad-card-thumb" src="${escapeHtml(ad.imageUrl || '')}" alt="" onerror="this.style.visibility='hidden'" />
            <div class="ad-card-body">
                <div class="ad-card-title">${escapeHtml(ad.title || '(no title)')}</div>
                <div class="ad-card-meta">${escapeHtml(window)}</div>
                <div class="ad-card-stats">
                    <span><strong>${impressions.toLocaleString()}</strong> views</span>
                    <span><strong>${uniqueViews.toLocaleString()}</strong> unique</span>
                    <span><strong>${clicks.toLocaleString()}</strong> clicks</span>
                    <span><strong>${ctr}</strong> CTR</span>
                    <span><strong>${dismissals.toLocaleString()}</strong> not interested</span>
                </div>
            </div>
        </a>
    `;
}
