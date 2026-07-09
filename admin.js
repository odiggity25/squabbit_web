import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';
import { initShowcase, loadShowcaseItems } from './adminShowcase.js';
import { initAds, loadAds, loadPendingAds } from './adminAds.js';
import { initAdvertisers, loadAdvertisers } from './adminAdvertisers.js';
import { initFeatureFlags, loadFeatureFlags } from './adminFeatureFlags.js';

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
const db = getFirestore(app);
const storage = getStorage(app);

initShowcase(db, storage);
initAds(db, storage, auth);
initAdvertisers(db);
initFeatureFlags(db, functions);

const loginSection = document.getElementById('login-section');
const adminTools = document.getElementById('admin-tools');
const loading = document.getElementById('loading');
const loginError = document.getElementById('login-error');
const signedInAs = document.getElementById('signed-in-as');

function showLogin() {
    loading.style.display = 'none';
    loginSection.style.display = 'block';
    adminTools.style.display = 'none';
}

function showAdmin(email) {
    loading.style.display = 'none';
    loginSection.style.display = 'none';
    adminTools.style.display = 'block';
    signedInAs.textContent = email;
    loadShowcaseItems();
    loadAds();
    loadPendingAds();
    loadAdvertisers();
    loadFeatureFlags();
}

function showLoading() {
    loading.style.display = 'block';
    loginSection.style.display = 'none';
    adminTools.style.display = 'none';
}

function deeplinkForUserId(userId) {
    return 'https://app.squabbitgolf.com/user?id=' + encodeURIComponent(userId);
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* fall through to legacy path */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) { return false; }
}

// Modal showing a player's name + deeplink, with the link pre-selected and a
// Copy button. Used after a restore-for-merge so the admin can grab the exact
// just-restored profile's link without hunting through same-named rows.
function showLinkDialog(title, name, link, message) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1080;padding:16px;';
    const card = document.createElement('div');
    card.className = 'card shadow p-4';
    card.style.cssText = 'max-width:480px;width:100%;';
    const h = document.createElement('h5'); h.className = 'mb-2'; h.textContent = title; card.appendChild(h);
    const nameDiv = document.createElement('div'); nameDiv.className = 'fw-semibold mb-2'; nameDiv.textContent = name; card.appendChild(nameDiv);
    if (message) { const p = document.createElement('p'); p.className = 'small text-muted'; p.textContent = message; card.appendChild(p); }
    const input = document.createElement('input'); input.type = 'text'; input.className = 'form-control mb-3'; input.readOnly = true; input.value = link; card.appendChild(input);
    const row = document.createElement('div'); row.className = 'd-flex gap-2';
    const copyBtn = document.createElement('button'); copyBtn.className = 'btn btn-primary flex-fill'; copyBtn.textContent = 'Copy link';
    copyBtn.addEventListener('click', async () => { const ok = await copyToClipboard(link); copyBtn.textContent = ok ? 'Copied!' : 'Copy failed'; setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500); });
    const closeBtn = document.createElement('button'); closeBtn.className = 'btn btn-outline-secondary'; closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    row.appendChild(copyBtn); row.appendChild(closeBtn); card.appendChild(row);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    input.focus(); input.select();
}

// Builds the user result row used by both the "Look Up Emails" list and the
// account-collision merge panel. `row` has the shape returned by
// getUserEmailsByName (userId, authId, email, name, avatar, homeCourseName,
// handicap, signInType) and, for the merge panel, roundCount + createDate.
// userId may be null when no Firestore doc was found.
// options.onDelete(row, item, btn) adds a Delete button (merge panel only).
function createUserRow(row, options = {}) {
    const item = document.createElement('div');
    item.className = 'd-flex gap-3 py-3 border-bottom align-items-start';

    const avatar = document.createElement('img');
    avatar.src = row.avatar || 'assets/icon_transparent.png';
    avatar.alt = '';
    avatar.style.cssText = 'width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#e9ecef;';
    avatar.onerror = () => { avatar.src = 'assets/icon_transparent.png'; };
    item.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'flex-grow-1 min-w-0';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'fw-semibold';
    nameDiv.textContent = row.name || '(no name)';
    if (row.deleted) {
        const badge = document.createElement('span');
        badge.className = 'badge bg-danger ms-2 align-middle';
        badge.textContent = 'Deleted';
        nameDiv.appendChild(badge);
    }
    info.appendChild(nameDiv);

    const emailDiv = document.createElement('div');
    if (row.deleted) {
        if (row.deletedEmail) {
            emailDiv.textContent = row.deletedEmail;
        } else {
            emailDiv.className = 'text-muted fst-italic';
            emailDiv.textContent = 'account deleted — email unknown';
        }
    } else {
        emailDiv.textContent = row.email;
    }
    info.appendChild(emailDiv);

    if (row.deleted && row.deletedAt) {
        const delDiv = document.createElement('small');
        delDiv.className = 'text-muted d-block';
        const d = new Date(row.deletedAt);
        delDiv.textContent = 'Deleted on: ' + (isNaN(d.getTime()) ? row.deletedAt : d.toLocaleDateString());
        info.appendChild(delDiv);
    }

    const metaParts = [];
    if (row.homeCourseName) metaParts.push(row.homeCourseName);
    metaParts.push('HCP ' + (row.handicap != null ? row.handicap : 'N/A'));
    const metaDiv = document.createElement('small');
    metaDiv.className = 'text-muted d-block';
    metaDiv.textContent = metaParts.join(' • ');
    info.appendChild(metaDiv);

    const userIdDiv = document.createElement('small');
    userIdDiv.className = 'text-muted d-block';
    userIdDiv.style.wordBreak = 'break-all';
    userIdDiv.textContent = 'userId: ' + (row.userId || '(no profile doc)');
    info.appendChild(userIdDiv);

    if (!row.deleted) {
        const authIdDiv = document.createElement('small');
        authIdDiv.className = 'text-muted d-block';
        authIdDiv.style.wordBreak = 'break-all';
        authIdDiv.textContent = 'authId: ' + row.authId;
        info.appendChild(authIdDiv);

        const signInDiv = document.createElement('small');
        signInDiv.className = 'text-muted d-block';
        signInDiv.textContent = 'Sign in: ' + (row.signInType || 'Unknown');
        info.appendChild(signInDiv);
    }

    if (row.roundCount != null) {
        const roundsDiv = document.createElement('small');
        roundsDiv.className = 'text-muted d-block';
        roundsDiv.textContent = 'Rounds: ' + row.roundCount;
        info.appendChild(roundsDiv);
    }

    if (row.createDate) {
        const createdDiv = document.createElement('small');
        createdDiv.className = 'text-muted d-block';
        const d = new Date(row.createDate);
        createdDiv.textContent = 'Created: ' + (isNaN(d.getTime()) ? row.createDate : d.toLocaleDateString());
        info.appendChild(createdDiv);
    }

    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'd-flex flex-column gap-2 flex-shrink-0';

    if (row.userId && !row.deleted) {
        const profileLink = document.createElement('a');
        profileLink.href = 'https://app.squabbitgolf.com/user?id=' + encodeURIComponent(row.userId);
        profileLink.target = '_blank';
        profileLink.rel = 'noopener';
        profileLink.className = 'btn btn-outline-primary btn-sm';
        profileLink.textContent = 'View Profile';
        actions.appendChild(profileLink);

        const copyLinkBtn = document.createElement('button');
        copyLinkBtn.type = 'button';
        copyLinkBtn.className = 'btn btn-outline-secondary btn-sm';
        copyLinkBtn.textContent = 'Copy link';
        copyLinkBtn.addEventListener('click', async () => {
            const ok = await copyToClipboard(deeplinkForUserId(row.userId));
            copyLinkBtn.textContent = ok ? 'Copied!' : 'Copy failed';
            setTimeout(() => { copyLinkBtn.textContent = 'Copy link'; }, 1500);
        });
        actions.appendChild(copyLinkBtn);
    }

    if (row.deleted && row.userId && !row.deletedEmail) {
        const findBtn = document.createElement('button');
        findBtn.type = 'button';
        findBtn.className = 'btn btn-outline-secondary btn-sm';
        findBtn.textContent = 'Find email';
        findBtn.addEventListener('click', () => findDeletedUserEmail(row, emailDiv, findBtn));
        actions.appendChild(findBtn);
    }

    if (row.deleted && row.userId) {
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn btn-success btn-sm';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', () => restoreDeletedUserRow(row, item, restoreBtn));
        actions.appendChild(restoreBtn);
    }

    if (options.onDelete && row.userId) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-outline-danger btn-sm';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => options.onDelete(row, item, deleteBtn));
        actions.appendChild(deleteBtn);
    }

    if (actions.children.length) item.appendChild(actions);

    return item;
}

// Resolves a deleted user's email on demand (resolveDeletedUserEmail). Uses the
// email captured at deletion time if present, else scans the auth backups for
// their original UID. Updates the row's email line and pre-fills Restore.
async function findDeletedUserEmail(row, emailDiv, btn) {
    btn.disabled = true;
    btn.textContent = 'Searching...';
    try {
        const res = await httpsCallable(functions, 'resolveDeletedUserEmail')({ userId: row.userId });
        if (res.data.email) {
            row.deletedEmail = res.data.email;
            emailDiv.className = '';
            emailDiv.textContent = res.data.email + (res.data.source === 'backup' ? ' (from backup)' : '');
            btn.remove();
        } else {
            emailDiv.textContent = 'account deleted — email not found in backups';
            btn.disabled = false;
            btn.textContent = 'Find email';
            window.alert('No email found in the auth backups (user may predate backups or had no email). You can still restore by typing the email they\'ll sign up with.');
        }
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Find email';
        window.alert('Email lookup failed: ' + (e.message || e));
    }
}

// Restores a deleted user (from the deletedUsers archive) back into the live
// users collection along with their archived rounds. The restored profile has
// no login, so we ask for the email they'll re-register with — restoreDeletedUser
// stores it as pendingEmail so their next sign-up re-links to this profile.
async function restoreDeletedUserRow(row, item, btn) {
    const who = row.name || row.userId;
    const rounds = row.roundCount != null ? row.roundCount : '?';
    if (!window.confirm(
        `Restore ${who}? This brings back their profile and ${rounds} archived round(s).\n\n` +
        `If their account is in the auth backups, their original login (Google/Apple/password) is recreated so they sign in exactly as before — no re-registration.`)) {
        return;
    }
    const setBtn = (label, cls, disabled) => { btn.textContent = label; if (cls) btn.className = cls; btn.disabled = !!disabled; };
    const markRestoredBadge = () => {
        const badge = item.querySelector('.badge');
        if (badge) { badge.className = 'badge bg-success ms-2 align-middle'; badge.textContent = 'Restored'; }
    };
    const isEmailCollision = (e) => e && e.details && e.details.reason === 'email_collision';

    // The person already re-registered, so we can't recreate their old login.
    // Restore the archived profile as a separate auth-less account; the player
    // then merges it into their current account in-app (it shows up in the
    // merge-duplicates search because it has no authId).
    const mergeRestore = async () => {
        if (!window.confirm(
            `${who} already has a live account on that email (they re-registered).\n\n` +
            `Restore their old profile + ${rounds} round(s) as a SEPARATE account so it can be merged into their current one?`)) {
            return null;
        }
        return await httpsCallable(functions, 'restoreDeletedUser')({ userId: row.userId, forMerge: true });
    };

    setBtn('Restoring...', null, true);
    try {
        let res = null;
        try {
            // Attempt the full auth restore first (no email needed — derived from backup).
            res = await httpsCallable(functions, 'restoreDeletedUser')({ userId: row.userId });
        } catch (e) {
            if (isEmailCollision(e)) {
                res = await mergeRestore();
            } else if (e && e.code === 'functions/failed-precondition') {
                // Not in the backups — fall back to re-register mode, which needs an email.
                const email = window.prompt(
                    `${who} isn't in the auth backups, so their login can't be auto-restored.\n\n` +
                    `Enter the email they'll re-register with (saved as pendingEmail so their next sign-up re-links to this profile):`,
                    row.deletedEmail || '');
                if (email === null) { setBtn('Restore', null, false); return; }
                const normalized = email.trim();
                if (!normalized) { window.alert('An email is required.'); setBtn('Restore', null, false); return; }
                try {
                    res = await httpsCallable(functions, 'restoreDeletedUser')({ userId: row.userId, email: normalized });
                } catch (e2) {
                    if (isEmailCollision(e2)) { res = await mergeRestore(); } else { throw e2; }
                }
            } else {
                throw e;
            }
        }
        if (res === null) { setBtn('Restore', null, false); return; } // cancelled at the merge prompt
        const d = res.data;
        markRestoredBadge();
        setBtn('Restored', 'btn btn-outline-secondary btn-sm', true);
        if (d.mode === 'merge') {
            const link = deeplinkForUserId(row.userId);
            const copied = await copyToClipboard(link);
            showLinkDialog(
                'Restored for merge',
                who,
                link,
                `Restored ${who}'s old profile with ${d.restoredRounds} round(s) as a separate account.${copied ? ' The link is copied to your clipboard.' : ''} Send it to the player so they can merge this profile (and its rounds) into their current account in the app.`
            );
        } else if (d.mode === 'full') {
            const provs = (d.providers || []).join(', ') || 'none';
            window.alert(`Restored ${who} with their original login (providers: ${provs}${d.passwordRestored ? ', password' : ''}). ${d.restoredRounds} round(s) restored. They can sign in exactly as before — no re-registration needed.`);
        } else {
            window.alert(`Restored ${who} in re-register mode. ${d.restoredRounds} round(s) restored. They sign up again with ${d.email} to regain access.`);
        }
    } catch (e) {
        setBtn('Restore', null, false);
        window.alert('Restore failed: ' + (e.message || e));
    }
}

// When both the current and new email already have registered accounts, the
// reset can't proceed as an email change — the two accounts must be merged.
// We can't run the merge from here (the data merge lives in the Flutter
// client), so we surface both accounts and route the admin to the in-app
// Sys Admin Merge tool.
function renderResetMerge(resetResult, accountA, accountB) {
    resetResult.className = 'alert alert-warning';
    resetResult.innerHTML = '<strong>Two separate accounts exist.</strong> Both emails are registered to different accounts, so this can\'t be done as an email change. To combine them, sign in to the app as a sysAdmin, open either profile below, and use <em>Sys Admin Merge</em>. If one is a newly-created duplicate with 0 rounds, delete it and run Reset Credentials again.';
    resetResult.classList.remove('d-none');

    const list = document.getElementById('reset-merge-list');
    list.innerHTML = '';
    const onDelete = (account, item, btn) => deleteCollisionAccount(account, item, btn, resetResult);
    list.appendChild(createUserRow(accountA, { onDelete }));
    list.appendChild(createUserRow(accountB, { onDelete }));
    document.getElementById('reset-merge-panel').classList.remove('d-none');
}

async function deleteCollisionAccount(account, item, btn, resetResult) {
    if (!account.userId) {
        window.alert('This account has no profile doc to delete.');
        return;
    }
    const who = account.name ? `${account.name} <${account.email}>` : account.email;
    const rounds = account.roundCount != null ? account.roundCount : '?';
    if (!window.confirm(`Delete ${who}? This account has ${rounds} round(s). It permanently deletes the account and frees the email. This cannot be undone.`)) return;
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
        await httpsCallable(functions, 'deleteUserAccount')({ userId: account.userId });
        item.remove();
        resetResult.className = 'alert alert-success';
        resetResult.textContent = `Deleted ${who}. Now run Reset Credentials again to set the email.`;
        resetResult.classList.remove('d-none');
    } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Delete';
        resetResult.className = 'alert alert-danger';
        resetResult.textContent = 'Delete failed: ' + (e.message || e);
        resetResult.classList.remove('d-none');
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        showLogin();
        return;
    }
    // sysAdmin status rarely changes, so cache the verifySysAdmin result per-uid
    // in localStorage (shared across all tabs) with a 1-hour TTL. Only the first
    // load per hour pays the (cold-start-prone) callable; refreshes and new tabs
    // within the window render instantly. The TTL bounds how long a revoked admin
    // could coast on a stale flag; sign-out clears it immediately.
    const SYSADMIN_TTL_MS = 60 * 60 * 1000;
    const sysAdminCacheKey = 'squabbitSysAdmin:' + user.uid;
    let cachedSysAdminTs = 0;
    try { cachedSysAdminTs = parseInt(localStorage.getItem(sysAdminCacheKey), 10) || 0; } catch (_) {}
    if (cachedSysAdminTs && Date.now() - cachedSysAdminTs < SYSADMIN_TTL_MS) {
        showAdmin(user.email);
        return;
    }
    showLoading();
    try {
        const result = await httpsCallable(functions, 'verifySysAdmin')();
        if (result.data.isSysAdmin) {
            try { localStorage.setItem(sysAdminCacheKey, String(Date.now())); } catch (_) {}
            showAdmin(user.email);
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

document.getElementById('sign-out-btn').addEventListener('click', () => {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('squabbitSysAdmin:')) localStorage.removeItem(k);
        }
    } catch (_) {}
    signOut(auth);
});

document.querySelectorAll('#user-action-tabs [data-user-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.userTab;
        document.querySelectorAll('#user-action-tabs [data-user-tab]').forEach((t) => {
            t.classList.toggle('active', t === tab);
        });
        document.querySelectorAll('[data-user-pane]').forEach((pane) => {
            pane.classList.toggle('d-none', pane.dataset.userPane !== target);
        });
    });
});

function switchAdminTab(target) {
    document.querySelectorAll('#admin-tabs [data-admin-tab]').forEach((t) => {
        t.classList.toggle('active', t.dataset.adminTab === target);
    });
    document.querySelectorAll('[data-admin-pane]').forEach((pane) => {
        pane.classList.toggle('d-none', pane.dataset.adminPane !== target);
    });
    try { localStorage.setItem('squabbitAdminTab', target); } catch (_) {}
}

document.querySelectorAll('#admin-tabs [data-admin-tab]').forEach((tab) => {
    tab.addEventListener('click', () => switchAdminTab(tab.dataset.adminTab));
});

// Restore the last-used tab when the admin tools become visible.
const savedTab = (() => { try { return localStorage.getItem('squabbitAdminTab'); } catch (_) { return null; } })();
if (savedTab && document.querySelector(`[data-admin-pane="${savedTab}"]`)) {
    switchAdminTab(savedTab);
}

document.getElementById('reset-btn').addEventListener('click', async () => {
    const resetResult = document.getElementById('reset-result');
    const email = document.getElementById('reset-email').value.trim();
    const newEmail = document.getElementById('reset-new-email').value.trim();
    resetResult.classList.add('d-none');
    document.getElementById('reset-merge-panel').classList.add('d-none');
    document.getElementById('reset-merge-list').innerHTML = '';
    if (!email) {
        resetResult.className = 'alert alert-warning';
        resetResult.textContent = 'Please enter the current email address.';
        resetResult.classList.remove('d-none');
        return;
    }
    const confirmMsg = newEmail
        ? `Delete the auth account for ${email} and set pendingEmail to ${newEmail}? This cannot be undone.`
        : `Disconnect the login for ${email} and set pendingEmail to the same address so they can re-register? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;
    const btn = document.getElementById('reset-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    try {
        const payload = newEmail ? { email, newEmail } : { email };
        const result = await httpsCallable(functions, 'resetUserCredentials')(payload);
        resetResult.className = 'alert alert-success';
        resetResult.textContent = 'Credentials reset. pendingEmail set to ' + result.data.email;
        resetResult.classList.remove('d-none');
        document.getElementById('reset-email').value = '';
        document.getElementById('reset-new-email').value = '';
    } catch (e) {
        const details = e && e.details;
        if (details && details.collision && details.accountA && details.accountB) {
            renderResetMerge(resetResult, details.accountA, details.accountB);
        } else {
            resetResult.className = 'alert alert-danger';
            resetResult.textContent = 'Error: ' + (e.message || e);
            resetResult.classList.remove('d-none');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Reset Credentials';
    }
});

document.getElementById('lookup-btn').addEventListener('click', async () => {
    const lookupResult = document.getElementById('lookup-result');
    const lookupList = document.getElementById('lookup-list');
    const name = document.getElementById('lookup-name').value.trim();
    lookupList.innerHTML = '';
    lookupResult.classList.add('d-none');
    if (!name) {
        lookupResult.className = 'alert alert-warning';
        lookupResult.textContent = 'Please enter a name.';
        return;
    }
    const btn = document.getElementById('lookup-btn');
    btn.disabled = true;
    btn.textContent = 'Looking up...';
    try {
        const result = await httpsCallable(functions, 'getUserEmailsByName')({ name });
        const results = result.data.results || [];
        if (results.length === 0) {
            lookupResult.className = 'alert alert-info';
            lookupResult.textContent = 'No users found with that name.';
        } else {
            const deletedCount = results.filter((r) => r.deleted).length;
            lookupResult.className = 'alert alert-success';
            lookupResult.textContent = `Found ${results.length} user${results.length === 1 ? '' : 's'}`
                + (deletedCount ? ` (${deletedCount} deleted).` : '.');
            for (const row of results) {
                lookupList.appendChild(createUserRow(row));
            }
        }
    } catch (e) {
        lookupResult.className = 'alert alert-danger';
        lookupResult.textContent = 'Error: ' + (e.message || e);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Look Up';
    }
});

document.getElementById('lookup-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('lookup-btn').click();
});

