import {
    auth,
    requireSignedIn,
    signInWithEmail,
    signInWithGoogle,
    signInWithApple,
    signOutUser,
    saveAdvertiser,
    escapeHtml,
} from '/advertise/shared.js';

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

requireSignedIn(async (user, advertiser) => {
    loadingEl.style.display = 'none';
    if (!user) {
        signedOutEl.style.display = 'block';
        signedInEl.style.display = 'none';
        return;
    }
    signedOutEl.style.display = 'none';
    signedInEl.style.display = 'block';

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

async function renderDashboard(user, advertiser) {
    const listEl = document.getElementById('ad-list');
    listEl.innerHTML = '<p class="text-muted small">Dashboard coming next — sign-in working.</p>';
    // Wired up fully in Task 4.
}
