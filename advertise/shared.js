import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    OAuthProvider,
    signOut,
    onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';

const firebaseConfig = {
    apiKey: 'AIzaSyDGVjvgrebAuRyRHOrztVLhRaUCP0N6TVM',
    appId: '1:535750845572:web:46e4c26866e4ef23584ed1',
    messagingSenderId: '535750845572',
    projectId: 'squabbit-2019',
    storageBucket: 'squabbit-2019.appspot.com',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
}

export function toLocalDatetimeString(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

export function formatDate(value) {
    if (!value) return '';
    const d = value.toDate ? value.toDate() : new Date(value);
    return d.toLocaleDateString();
}

export async function signInWithEmail(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
}

export async function signInWithApple() {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    await signInWithPopup(auth, provider);
}

export async function signOutUser() {
    await signOut(auth);
}

export async function getAdvertiser(uid) {
    const snap = await getDoc(doc(db, 'advertisers', uid));
    return snap.exists() ? snap.data() : null;
}

export async function saveAdvertiser(uid, { brandName, contactEmail, website }) {
    const ref = doc(db, 'advertisers', uid);
    const existing = await getDoc(ref);
    const payload = {
        brandName: brandName.trim(),
        contactEmail: contactEmail.trim(),
        website: (website || '').trim(),
        lastActiveAt: serverTimestamp(),
    };
    if (existing.exists()) {
        await updateDoc(ref, payload);
    } else {
        payload.createdAt = serverTimestamp();
        await setDoc(ref, payload);
    }
}

export async function touchAdvertiserActivity(uid) {
    try {
        await updateDoc(doc(db, 'advertisers', uid), { lastActiveAt: serverTimestamp() });
    } catch (_) { /* missing doc is fine */ }
}

// Hides #signed-out-view, shows #signed-in-view, and invokes onReady(user, advertiser)
// once auth resolves and the advertiser profile is fetched. If no profile exists yet,
// advertiser is null and the caller is expected to route to a profile-setup view.
export function requireSignedIn(onReady) {
    const signedOut = document.getElementById('signed-out-view');
    const signedIn = document.getElementById('signed-in-view');
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            if (signedOut) signedOut.style.display = 'block';
            if (signedIn) signedIn.style.display = 'none';
            onReady(null, null);
            return;
        }
        if (signedOut) signedOut.style.display = 'none';
        if (signedIn) signedIn.style.display = 'block';
        const advertiser = await getAdvertiser(user.uid);
        onReady(user, advertiser);
    });
}
