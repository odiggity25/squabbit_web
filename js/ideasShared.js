import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getDoc,
    doc,
    onSnapshot,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import {
    ref,
    uploadBytesResumable,
    getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js';
import { db, storage, functions } from './ideasAuth.js';

export const STATUS_LABELS = {
    open: 'Open',
    planned: 'Planned',
    in_progress: 'In Progress',
    shipped: 'Shipped',
    declined: 'Declined',
};

export const CATEGORY_LABELS = {
    tournaments: 'Tournaments',
    leagues: 'Leagues',
    scoring: 'Scoring',
    mobile: 'Mobile',
    web: 'Web',
    other: 'Other',
};

function getInitials(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = ['#1E7A4A', '#0e7490', '#7c3aed', '#be185d', '#c2410c', '#a16207', '#4d7c0f', '#0369a1', '#9d174d', '#3730a3'];

function nameColor(name) {
    const s = name || '';
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function avatarHtml(avatarUrl, name, sizePx = 36, extraClass = '') {
    const cls = `avatar avatar-${sizePx}${extraClass ? ' ' + extraClass : ''}`;
    if (avatarUrl && avatarUrl.trim()) {
        return `<img class="${cls}" src="${escapeHtml(avatarUrl)}" alt="" data-avatar-name="${escapeHtml(name || '')}" />`;
    }
    const initials = getInitials(name);
    const bg = nameColor(name);
    return `<span class="${cls} avatar-initials" style="background:${bg};">${escapeHtml(initials)}</span>`;
}

if (typeof document !== 'undefined') {
    document.addEventListener('error', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.classList.contains('avatar')) {
            const name = t.dataset.avatarName || '';
            const span = document.createElement('span');
            span.className = t.className + ' avatar-initials';
            span.style.background = nameColor(name);
            span.textContent = getInitials(name);
            t.replaceWith(span);
        }
    }, true);
}

export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function linkify(s) {
    const escaped = escapeHtml(s);
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`);
}

export function relativeTime(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - date.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    if (day < 30) return `${Math.floor(day / 7)}w ago`;
    if (day < 365) return `${Math.floor(day / 30)}mo ago`;
    return `${Math.floor(day / 365)}y ago`;
}

export function statusBadge(status) {
    const label = STATUS_LABELS[status] || status;
    return `<span class="status-badge s-${status}">${escapeHtml(label)}</span>`;
}

export function categoryChip(category) {
    const label = CATEGORY_LABELS[category] || category;
    return `<span class="category-chip">${escapeHtml(label)}</span>`;
}

export async function fetchIdeas({ status = 'all', category = 'all', sort = 'top', search = '' } = {}) {
    const constraints = [];
    if (status !== 'all' && category !== 'all') {
        constraints.push(where('status', '==', status));
        constraints.push(where('category', '==', category));
    } else if (status !== 'all') {
        constraints.push(where('status', '==', status));
    } else if (category !== 'all') {
        constraints.push(where('category', '==', category));
    }
    constraints.push(orderBy(sort === 'new' ? 'createdAt' : 'voteCount', 'desc'));
    constraints.push(limit(100));
    const q = query(collection(db, 'featureRequests'), ...constraints);
    const snap = await getDocs(q);
    let ideas = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((idea) => !idea.mergedIntoId);
    if (search) {
        const needle = search.toLowerCase();
        ideas = ideas.filter((i) =>
            (i.title || '').toLowerCase().includes(needle) ||
            (i.description || '').toLowerCase().includes(needle));
    }
    return ideas;
}

export async function fetchOwnVotes(userId, requestIds) {
    if (!userId || requestIds.length === 0) return new Set();
    const checks = await Promise.all(requestIds.map(async (id) => {
        const snap = await getDoc(doc(db, `featureRequests/${id}/votes/${userId}`));
        return snap.exists() ? id : null;
    }));
    return new Set(checks.filter(Boolean));
}

export async function getUserDocId(authId) {
    if (!authId) return null;
    const snap = await getDocs(query(collection(db, 'users'), where('authId', '==', authId), limit(1)));
    return snap.empty ? null : snap.docs[0].id;
}

export async function getUserProfile(authId) {
    if (!authId) return null;
    const snap = await getDocs(query(collection(db, 'users'), where('authId', '==', authId), limit(1)));
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return {
        userDocId: snap.docs[0].id,
        name: data.name || '',
        avatarUrl: data.avatarUrl || data.avatar || '',
    };
}

export async function getCallerIsSysAdmin(userDocId) {
    if (!userDocId) return false;
    try {
        const cfgSnap = await getDoc(doc(db, 'configs/squabbitConfig'));
        if (!cfgSnap.exists()) return false;
        const list = cfgSnap.get('sysAdmins') || [];
        return list.includes(userDocId);
    } catch (e) {
        return false;
    }
}

export function callable(name) {
    return httpsCallable(functions, name);
}

export async function uploadAttachment(file, authId, onProgress) {
    if (!file.type.startsWith('image/')) {
        throw new Error('Only image files are allowed.');
    }
    if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image must be 5MB or smaller.');
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `featureRequests/uploads/${authId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const r = ref(storage, storagePath);
    const task = uploadBytesResumable(r, file, { contentType: file.type });
    return new Promise((resolve, reject) => {
        task.on(
            'state_changed',
            (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
            reject,
            async () => {
                const url = await getDownloadURL(task.snapshot.ref);
                resolve({ url, storagePath, contentType: file.type });
            }
        );
    });
}

export function showToast(message, { error = false } = {}) {
    const el = document.getElementById('ideas-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', error);
    el.classList.add('is-shown');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-shown'), 3000);
}

export function watchIdeaDoc(requestId, handler) {
    return onSnapshot(doc(db, `featureRequests/${requestId}`), (snap) => {
        if (snap.exists()) handler({ id: snap.id, ...snap.data() });
    });
}

export function watchIdeaComments(requestId, handler) {
    const q = query(
        collection(db, `featureRequests/${requestId}/comments`),
        orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
        const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        handler(comments);
    });
}
