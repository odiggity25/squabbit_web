# Admin: Fix Signup Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sysAdmin tool that lets us fix users who signed up with the wrong email so they can re-register with the correct address and auto-link to their existing Firestore profile.

**Architecture:** New `removeIncorrectEmailAndAssignNewPendingEmail` callable cloud function that mirrors `resetUserCredentials`'s sysAdmin auth + Firestore-update-before-auth-delete pattern, but uses a caller-supplied `correctEmail` for `pendingEmail` instead of the auth user's own email. New Bootstrap card in the admin web tool with a `confirm()` dialog before invoking the function.

**Tech Stack:** Firebase Cloud Functions (Node.js, ESM), Firebase Auth Admin SDK, Firestore Admin SDK, vanilla JS + Bootstrap 5 in the admin web app.

**Note on testing:** There is no JS test infrastructure in `squabbit_cloud` or `squabbit_web`. The pattern matches `resetUserCredentials`, `getUserEmail`, and `getUserEmailsByName`, all verified via manual emulator + production smoke tests. This plan uses manual verification steps in place of automated tests.

---

## File Structure

**Created:** none.

**Modified:**
- `squabbit_cloud/functions/src/users.js` — append the new `removeIncorrectEmailAndAssignNewPendingEmail` callable.
- `squabbit_cloud/functions/index.js` — add `removeIncorrectEmailAndAssignNewPendingEmail` to the export list from `./src/users.js`.
- `squabbit_web/admin.html` — add a new Bootstrap card inside `#admin-tools`, between the existing "Reset User Credentials" card and the "Look Up User Emails" card.
- `squabbit_web/admin.js` — add a new click handler near the existing `reset-btn` handler.

Each file owns the layer it already owns: `users.js` holds user-management cloud functions, `admin.html` holds the admin UI markup, `admin.js` holds the wiring. No new files needed.

---

### Task 1: Add `removeIncorrectEmailAndAssignNewPendingEmail` cloud function

**Files:**
- Modify: `squabbit_cloud/functions/src/users.js` (append at end of file)

- [ ] **Step 1: Add the new export at the end of `users.js`**

Append this code immediately after the existing `getUserEmailsByName` export (after the closing `});` near the bottom of the file):

```js
/**
 * Fixes a user who signed up with the wrong email by clearing the auth
 * account at the incorrect email and setting pendingEmail to the correct
 * email on their Firestore user doc, so they can re-register with the
 * correct address and auto-link via the existing pendingEmail flow.
 *
 * Must clear authId before deleting the auth user to prevent the
 * deleteProfile trigger from also deleting the Firestore user doc.
 */
export const removeIncorrectEmailAndAssignNewPendingEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  // Verify caller is a sysAdmin
  const callerAuthId = context.auth.uid;
  const callerSnap = await admin.firestore().collection('users')
    .where('authId', '==', callerAuthId).limit(1).get();
  if (callerSnap.empty) {
    throw new functions.https.HttpsError('permission-denied', 'Caller user not found');
  }
  const configSnap = await admin.firestore().doc('configs/squabbitConfig').get();
  const sysAdmins = configSnap.get('sysAdmins') || [];
  if (!sysAdmins.includes(callerSnap.docs[0].id)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a sysAdmin');
  }

  // Validate inputs
  const { incorrectEmail, correctEmail } = data;
  if (!incorrectEmail || typeof incorrectEmail !== 'string' ||
      !correctEmail || typeof correctEmail !== 'string') {
    throw new functions.https.HttpsError('invalid-argument',
      'incorrectEmail and correctEmail are required');
  }
  const incorrect = incorrectEmail.trim().toLowerCase();
  const correct = correctEmail.trim().toLowerCase();
  if (!incorrect || !correct) {
    throw new functions.https.HttpsError('invalid-argument',
      'incorrectEmail and correctEmail must be non-empty');
  }
  if (incorrect === correct) {
    throw new functions.https.HttpsError('invalid-argument',
      'incorrectEmail and correctEmail must differ');
  }

  // Look up auth user for the incorrect email
  let authId;
  try {
    const authUser = await admin.auth().getUserByEmail(incorrect);
    authId = authUser.uid;
  } catch (e) {
    throw new functions.https.HttpsError('not-found',
      `No Firebase Auth user found for incorrect email: ${incorrect}`);
  }

  // Collision check: correct email must NOT already have an auth account
  try {
    await admin.auth().getUserByEmail(correct);
    throw new functions.https.HttpsError('already-exists',
      `Correct email already has an auth account: ${correct} — resolve manually`);
  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    if (e.code !== 'auth/user-not-found') {
      throw new functions.https.HttpsError('internal',
        `Error checking correct email: ${e.message}`);
    }
    // auth/user-not-found is the expected/desired path — proceed.
  }

  // Find the Firestore user doc by authId
  const usersSnap = await admin.firestore().collection('users')
    .where('authId', '==', authId).limit(1).get();
  if (usersSnap.empty) {
    throw new functions.https.HttpsError('not-found',
      `No user doc found with authId for incorrect email: ${incorrect}`);
  }
  const userDoc = usersSnap.docs[0];
  const userRef = userDoc.ref;

  // Clear authId and set pendingEmail BEFORE deleting auth user.
  // The deleteProfile trigger keys off authId; clearing it first prevents
  // the trigger from deleting the Firestore user doc.
  await userRef.update({
    pendingEmail: correct,
    authId: admin.firestore.FieldValue.delete(),
    registered: false,
  });

  await admin.auth().deleteUser(authId);

  const targetUserId = userDoc.id;
  console.log(`Fixed signup email for user ${targetUserId}: cleared authId ${authId} (was ${incorrect}), pendingEmail set to ${correct}`);
  return { success: true, userId: targetUserId, pendingEmail: correct };
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/orrie/code/squabbit_cloud
git add functions/src/users.js
git commit -m "Add removeIncorrectEmailAndAssignNewPendingEmail cloud function for admin tool"
```

---

### Task 2: Export `removeIncorrectEmailAndAssignNewPendingEmail` from `index.js`

**Files:**
- Modify: `squabbit_cloud/functions/index.js:19`

- [ ] **Step 1: Update the users.js export line**

Replace the existing line 19:

```js
export { deleteProfile, onUserCreated, userUpdated, resetUserCredentials, getUserEmail, getUserEmailsByName, verifySysAdmin } from './src/users.js';
```

with:

```js
export { deleteProfile, onUserCreated, userUpdated, resetUserCredentials, getUserEmail, getUserEmailsByName, removeIncorrectEmailAndAssignNewPendingEmail, verifySysAdmin } from './src/users.js';
```

- [ ] **Step 2: Commit**

```bash
cd /Users/orrie/code/squabbit_cloud
git add functions/index.js
git commit -m "Export removeIncorrectEmailAndAssignNewPendingEmail from cloud functions index"
```

---

### Task 3: Add the admin UI card

**Files:**
- Modify: `squabbit_web/admin.html` (insert after the existing "Reset User Credentials" card at lines 67–76, before the "Look Up User Emails" card that starts at line 78)

- [ ] **Step 1: Insert the new card**

After the closing `</div>` of the "Reset User Credentials" card (`squabbit_web/admin.html:76`) and before the existing `<div class="card shadow-sm p-4 mt-4">` that opens "Look Up User Emails" (line 78), insert:

```html
            <div class="card shadow-sm p-4 mt-4">
                <h5 class="mb-3">Fix Signup Email</h5>
                <p class="text-muted small">Resets a user who signed up with the wrong email so they can re-register with the correct one.</p>
                <div id="fix-signup-result" class="alert d-none"></div>
                <div class="mb-3">
                    <label for="fix-signup-incorrect" class="form-label">Incorrect Email</label>
                    <input type="email" class="form-control" id="fix-signup-incorrect" />
                </div>
                <div class="mb-3">
                    <label for="fix-signup-correct" class="form-label">Correct Email</label>
                    <input type="email" class="form-control" id="fix-signup-correct" />
                </div>
                <button class="btn btn-danger w-100" id="fix-signup-btn">Fix Signup Email</button>
            </div>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/orrie/code/squabbit_web
git add admin.html
git commit -m "Add Fix Signup Email card to admin tool"
```

---

### Task 4: Wire up the admin click handler

**Files:**
- Modify: `squabbit_web/admin.js` (append after the `lookup-name` keydown handler at line 219–221, at the end of the file)

- [ ] **Step 1: Append the click handler**

Add at the end of `admin.js`:

```js
document.getElementById('fix-signup-btn').addEventListener('click', async () => {
    const result = document.getElementById('fix-signup-result');
    const incorrectEmail = document.getElementById('fix-signup-incorrect').value.trim();
    const correctEmail = document.getElementById('fix-signup-correct').value.trim();
    result.classList.add('d-none');
    if (!incorrectEmail || !correctEmail) {
        result.className = 'alert alert-warning';
        result.textContent = 'Both incorrect and correct emails are required.';
        result.classList.remove('d-none');
        return;
    }
    const ok = window.confirm(
        `Delete the auth account for ${incorrectEmail} and set pendingEmail to ${correctEmail}? This cannot be undone.`
    );
    if (!ok) return;
    const btn = document.getElementById('fix-signup-btn');
    btn.disabled = true;
    btn.textContent = 'Fixing...';
    try {
        const res = await httpsCallable(functions, 'removeIncorrectEmailAndAssignNewPendingEmail')({ incorrectEmail, correctEmail });
        result.className = 'alert alert-success';
        result.textContent = 'Signup email fixed. pendingEmail set to ' + res.data.pendingEmail;
        document.getElementById('fix-signup-incorrect').value = '';
        document.getElementById('fix-signup-correct').value = '';
    } catch (e) {
        result.className = 'alert alert-danger';
        result.textContent = 'Error: ' + (e.message || e);
    } finally {
        result.classList.remove('d-none');
        btn.disabled = false;
        btn.textContent = 'Fix Signup Email';
    }
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/orrie/code/squabbit_web
git add admin.js
git commit -m "Wire up Fix Signup Email button in admin tool"
```

---

### Task 5: Manual verification

No automated tests — verify the end-to-end flow manually before considering the feature done.

- [ ] **Step 1: Verify cloud function loads in emulator**

```bash
cd /Users/orrie/code/squabbit_cloud
firebase emulators:start --import=data --export-on-exit
```

Expected: emulator boots without errors. The functions log lists `removeIncorrectEmailAndAssignNewPendingEmail` among the loaded callables.

- [ ] **Step 2: Smoke test against emulator (happy path)**

While the emulator is running, in the Firestore emulator UI (http://localhost:4000) confirm there's a seeded user with a known `authId` and matching auth account email. From a browser console signed in as a sysAdmin (or via the deployed admin tool pointed at the emulator), call:

```js
firebase.app().functions().httpsCallable('removeIncorrectEmailAndAssignNewPendingEmail')({
  incorrectEmail: 'wrong@example.com',
  correctEmail: 'right@example.com',
});
```

Expected:
- Returns `{ success: true, userId: '...', pendingEmail: 'right@example.com' }`.
- The Firestore user doc has `pendingEmail: 'right@example.com'`, no `authId`, `registered: false`.
- The Firebase Auth user for `wrong@example.com` is gone.
- The Firestore user doc still exists (deleteProfile trigger did NOT wipe it).

- [ ] **Step 3: Smoke test error paths**

Verify each error returns a useful message:

- Both fields empty → frontend warning, no call.
- Same email twice → `invalid-argument` "must differ".
- Incorrect email with no auth account → `not-found`.
- Correct email already has an auth account (seed one) → `already-exists`.
- Caller not a sysAdmin → `permission-denied`.

- [ ] **Step 4: Verify admin UI in deployed admin tool**

Deploy or run locally; confirm the new card renders between "Reset User Credentials" and "Look Up User Emails", the `confirm()` dialog appears, success/error alerts surface as expected, and inputs clear on success.

- [ ] **Step 5: Verify the auto-link flow end to end**

After running `removeIncorrectEmailAndAssignNewPendingEmail` successfully, sign up a fresh auth account in the app using the correct email. Confirm the existing `pendingEmail` flow reattaches the new auth user to the same Firestore user doc (no duplicate doc created).

- [ ] **Step 6: Deploy**

Wait for explicit user approval before deploying. When approved:

```bash
cd /Users/orrie/code/squabbit_cloud
firebase deploy --only functions:removeIncorrectEmailAndAssignNewPendingEmail
```

(`squabbit_web/admin.html` and `admin.js` are static files — deploy via the normal site deploy process.)
