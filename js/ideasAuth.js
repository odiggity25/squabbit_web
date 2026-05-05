import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    signInWithPopup,
    signInWithCustomToken,
    GoogleAuthProvider,
    sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

const firebaseConfig = {
    apiKey: 'AIzaSyDGVjvgrebAuRyRHOrztVLhRaUCP0N6TVM',
    appId: '1:535750845572:web:46e4c26866e4ef23584ed1',
    messagingSenderId: '535750845572',
    projectId: 'squabbit-2019',
    storageBucket: 'squabbit-2019.appspot.com',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

const googleProvider = new GoogleAuthProvider();

const tokenHandoff = consumeAuthTokenFromHash();

function consumeAuthTokenFromHash() {
    const hash = location.hash || '';
    const match = hash.match(/(?:^|[#&])token=([^&]+)/);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    history.replaceState(null, '', location.pathname + location.search);
    return signInWithCustomToken(auth, token).catch((err) => {
        console.warn('App-to-web auth handoff failed:', err);
    });
}

export function authReady() {
    return tokenHandoff || Promise.resolve();
}

export function currentUser() {
    return new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
            unsub();
            resolve(user);
        });
    });
}

export function onUserChange(handler) {
    return onAuthStateChanged(auth, handler);
}

export async function signOutUser() {
    await signOut(auth);
}

let modalEl = null;

function ensureModal() {
    if (modalEl) return modalEl;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div class="ideas-auth-backdrop" data-close>
            <div class="ideas-auth-modal" role="dialog" aria-modal="true" aria-label="Sign in">
                <button class="ideas-auth-close" data-close aria-label="Close">&times;</button>
                <div class="ideas-auth-header">
                    <h3>Sign in to continue</h3>
                    <p>Use your Squabbit account to vote, submit ideas, and comment.</p>
                </div>
                <div class="ideas-auth-providers">
                    <button class="ideas-auth-provider" data-provider="google">
                        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4c-7.5 0-13.9 4.1-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.9 39.8 16.4 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.2C40.9 36.3 44 30.7 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                        Continue with Google
                    </button>
                </div>
                <p class="ideas-auth-hint">Already use Squabbit on iOS or Android? Open <strong>Ideas</strong> from the app to skip sign-in.</p>
                <div class="ideas-auth-divider"><span>or</span></div>
                <form class="ideas-auth-form" data-mode="signin">
                    <div class="ideas-auth-error" hidden></div>
                    <label>
                        <span>Email</span>
                        <input type="email" name="email" required autocomplete="email" />
                    </label>
                    <label>
                        <span>Password</span>
                        <input type="password" name="password" required autocomplete="current-password" minlength="6" />
                    </label>
                    <button type="submit" class="ideas-auth-submit">Sign in</button>
                    <div class="ideas-auth-switch">
                        <a href="#" data-action="reset">Forgot password</a>
                        <a href="#" data-action="toggle">Need an account? Register</a>
                    </div>
                </form>
            </div>
        </div>
    `;
    modalEl = wrap.firstElementChild;
    document.body.appendChild(modalEl);
    wireModal();
    return modalEl;
}

let pendingResolve = null;

function wireModal() {
    const closeIfBackdrop = (e) => {
        if (e.target.dataset.close !== undefined) closeModal(null);
    };
    modalEl.addEventListener('click', closeIfBackdrop);

    modalEl.querySelector('[data-provider="google"]').addEventListener('click', () => doProvider(googleProvider));

    const form = modalEl.querySelector('.ideas-auth-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim();
        const password = form.password.value;
        const errorEl = modalEl.querySelector('.ideas-auth-error');
        errorEl.hidden = true;
        const submit = form.querySelector('.ideas-auth-submit');
        submit.disabled = true;
        const originalText = submit.textContent;
        submit.textContent = '...';
        try {
            const cred = form.dataset.mode === 'signup'
                ? await createUserWithEmailAndPassword(auth, email, password)
                : await signInWithEmailAndPassword(auth, email, password);
            closeModal(cred.user);
        } catch (err) {
            errorEl.textContent = friendlyError(err);
            errorEl.hidden = false;
        } finally {
            submit.disabled = false;
            submit.textContent = originalText;
        }
    });

    modalEl.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
        e.preventDefault();
        const isSignup = form.dataset.mode === 'signup';
        form.dataset.mode = isSignup ? 'signin' : 'signup';
        form.querySelector('.ideas-auth-submit').textContent = isSignup ? 'Sign in' : 'Create account';
        e.target.textContent = isSignup ? 'Need an account? Register' : 'Have an account? Sign in';
        form.password.autocomplete = isSignup ? 'current-password' : 'new-password';
    });

    modalEl.querySelector('[data-action="reset"]').addEventListener('click', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim();
        const errorEl = modalEl.querySelector('.ideas-auth-error');
        if (!email) {
            errorEl.textContent = 'Enter your email above first, then click "Forgot password".';
            errorEl.hidden = false;
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            errorEl.classList.add('ideas-auth-info');
            errorEl.textContent = `Reset email sent to ${email}.`;
            errorEl.hidden = false;
        } catch (err) {
            errorEl.textContent = friendlyError(err);
            errorEl.hidden = false;
        }
    });
}

async function doProvider(provider) {
    const errorEl = modalEl.querySelector('.ideas-auth-error');
    errorEl.hidden = true;
    try {
        const cred = await signInWithPopup(auth, provider);
        closeModal(cred.user);
    } catch (err) {
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
        errorEl.textContent = friendlyError(err);
        errorEl.hidden = false;
    }
}

function friendlyError(err) {
    const code = err.code || '';
    const map = {
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/wrong-password': 'Invalid email or password.',
        'auth/user-not-found': 'No account with that email.',
        'auth/email-already-in-use': 'An account with that email already exists. Try signing in.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
        'auth/operation-not-allowed': 'This sign-in method is not enabled yet.',
    };
    return map[code] || err.message || 'Sign in failed.';
}

function openModal() {
    ensureModal();
    modalEl.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => modalEl.querySelector('input[name="email"]').focus(), 50);
}

function closeModal(user) {
    if (!modalEl) return;
    modalEl.classList.remove('is-open');
    document.body.style.overflow = '';
    if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r(user);
    }
}

export function requireUser() {
    return new Promise(async (resolve) => {
        const existing = await currentUser();
        if (existing) {
            resolve(existing);
            return;
        }
        pendingResolve = resolve;
        openModal();
    });
}
