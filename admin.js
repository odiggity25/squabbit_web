import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';
import { initShowcase, loadShowcaseItems } from './adminShowcase.js';
import { initAds, loadAds } from './adminAds.js';

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
initAds(db, storage);

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
}

function showLoading() {
    loading.style.display = 'block';
    loginSection.style.display = 'none';
    adminTools.style.display = 'none';
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        showLogin();
        return;
    }
    showLoading();
    try {
        const result = await httpsCallable(functions, 'verifySysAdmin')();
        if (result.data.isSysAdmin) {
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

document.getElementById('sign-out-btn').addEventListener('click', () => signOut(auth));

document.getElementById('reset-btn').addEventListener('click', async () => {
    const resetResult = document.getElementById('reset-result');
    const email = document.getElementById('reset-email').value.trim();
    if (!email) {
        resetResult.className = 'alert alert-warning';
        resetResult.textContent = 'Please enter an email address.';
        return;
    }
    const btn = document.getElementById('reset-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    resetResult.classList.add('d-none');
    try {
        const result = await httpsCallable(functions, 'resetUserCredentials')({ email });
        resetResult.className = 'alert alert-success';
        resetResult.textContent = 'Credentials reset. pendingEmail set to ' + result.data.email;
        document.getElementById('reset-email').value = '';
    } catch (e) {
        resetResult.className = 'alert alert-danger';
        resetResult.textContent = 'Error: ' + (e.message || e);
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
            lookupResult.textContent = 'No registered users found with that name.';
        } else {
            lookupResult.className = 'alert alert-success';
            lookupResult.textContent = `Found ${results.length} user${results.length === 1 ? '' : 's'}.`;
            for (const row of results) {
                const item = document.createElement('div');
                item.className = 'py-2 border-bottom';
                const emailDiv = document.createElement('div');
                emailDiv.className = 'fw-semibold';
                emailDiv.textContent = row.email;
                const userIdDiv = document.createElement('small');
                userIdDiv.className = 'text-muted';
                userIdDiv.textContent = 'userId: ' + row.userId;
                item.appendChild(emailDiv);
                item.appendChild(userIdDiv);
                lookupList.appendChild(item);
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
