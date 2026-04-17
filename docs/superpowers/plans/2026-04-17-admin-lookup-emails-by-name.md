# Admin: Look Up User Emails by Name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin page section that, given an exact user name, returns the emails of all registered users whose Firestore `users` doc has that name.

**Architecture:** A new callable Cloud Function `getUserEmailsByName` handles the sysAdmin check, Firestore `name ==` query, and Firebase Auth email lookup (since `admin.auth().getUser()` is server-only). A new Bootstrap card in `admin.html` plus a click handler in `admin.js` wire the UI to the callable and render one `{ email, userId }` row per match.

**Tech Stack:** Firebase v1 callable functions (`functions.https.onCall`), Firestore Admin SDK, Firebase Auth Admin SDK, Firebase Web SDK v11 (`httpsCallable`), vanilla JS + Bootstrap 5.

**Repos touched:**
- Cloud functions: `/Users/orrie/code/squabbit_cloud/`
- Web app: `/Users/orrie/code/squabbit_web/`

**Note on testing:** There's no JS test infrastructure in this repo. The function pattern matches `resetUserCredentials` / `getUserEmail` which are verified via manual emulator + prod testing. This plan uses manual verification steps in place of automated tests.

---

## Task 1: Add `getUserEmailsByName` cloud function

**Files:**
- Modify: `/Users/orrie/code/squabbit_cloud/functions/src/users.js` (append new function at end of file)

- [ ] **Step 1: Add the function body**

Open `/Users/orrie/code/squabbit_cloud/functions/src/users.js`. At the end of the file (after `verifySysAdmin`, preserving the existing trailing newline), append:

```javascript

/**
 * Gets emails for all registered users whose Firestore 'name' field
 * exactly matches the provided name. Requires the caller to be a sysAdmin.
 * Users without an authId are skipped (unregistered / pending-invite).
 * Individual Firebase Auth lookup failures are logged and skipped.
 */
export const getUserEmailsByName = functions.https.onCall(async (data, context) => {
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

  const { name } = data;
  if (!name || typeof name !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'name is required');
  }

  const usersSnap = await admin.firestore().collection('users')
    .where('name', '==', name).get();

  const results = [];
  for (const doc of usersSnap.docs) {
    const authId = doc.data().authId;
    if (!authId) continue;
    try {
      const authUser = await admin.auth().getUser(authId);
      if (authUser.email) {
        results.push({ userId: doc.id, email: authUser.email });
      }
    } catch (e) {
      console.log(`Auth lookup failed for userId=${doc.id} authId=${authId}: ${e.message}`);
    }
  }

  return { results };
});
```

- [ ] **Step 2: Verify file still parses**

Run:
```
cd /Users/orrie/code/squabbit_cloud/functions && node --check src/users.js
```
Expected: no output (successful parse). If a syntax error is reported, fix and re-run.

- [ ] **Step 3: Commit**

```
cd /Users/orrie/code/squabbit_cloud && git add functions/src/users.js && git status
```
Show the user the staged diff and ask for approval before running:
```
git commit -m "Add getUserEmailsByName callable for admin email lookup"
```

---

## Task 2: Export `getUserEmailsByName` from cloud functions index

**Files:**
- Modify: `/Users/orrie/code/squabbit_cloud/functions/index.js:18`

- [ ] **Step 1: Add the export**

Change this line:
```javascript
export { deleteProfile, onUserCreated, userUpdated, resetUserCredentials, getUserEmail, verifySysAdmin } from './src/users.js';
```
To:
```javascript
export { deleteProfile, onUserCreated, userUpdated, resetUserCredentials, getUserEmail, getUserEmailsByName, verifySysAdmin } from './src/users.js';
```

- [ ] **Step 2: Verify index still parses**

Run:
```
cd /Users/orrie/code/squabbit_cloud/functions && node --check index.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```
cd /Users/orrie/code/squabbit_cloud && git add functions/index.js && git status
```
Show the user the diff and ask for approval before running:
```
git commit -m "Export getUserEmailsByName from functions index"
```

---

## Task 3: Add the "Look Up User Emails" card to admin.html

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/admin.html` (insert a new card after the existing "Reset User Credentials" card, which ends at line 76)

- [ ] **Step 1: Insert the new card**

In `admin.html`, locate the closing `</div>` of the "Reset User Credentials" card (the one containing the `#reset-btn` button — line 76). Immediately after that `</div>`, insert:

```html

            <div class="card shadow-sm p-4 mt-4">
                <h5 class="mb-3">Look Up User Emails</h5>
                <p class="text-muted small">Find registered users by their in-app name (exact match).</p>
                <div id="lookup-result" class="alert d-none"></div>
                <div class="mb-3">
                    <label for="lookup-name" class="form-label">User Name</label>
                    <input type="text" class="form-control" id="lookup-name" />
                </div>
                <button class="btn btn-primary w-100" id="lookup-btn">Look Up</button>
                <div id="lookup-list" class="mt-3"></div>
            </div>
```

The surrounding structure after the change should read (for orientation only — do not re-insert the unchanged parts):
```
            </div>  <!-- end of Reset User Credentials card -->

            <div class="card shadow-sm p-4 mt-4">  <!-- new Look Up User Emails card -->
                ...
            </div>

            <div class="card shadow-sm p-4 mt-4">  <!-- existing Showcase Items card -->
```

- [ ] **Step 2: Verify the page loads in a browser**

Open `admin.html` locally (serve via whatever command the project normally uses, or open the file directly). Sign in as sysAdmin and confirm the new card appears between "Reset User Credentials" and "Showcase Items". Visually confirm: label, input field, button, and an empty result area.

- [ ] **Step 3: Commit**

```
cd /Users/orrie/code/squabbit_web && git add admin.html && git status
```
Show the user the diff and ask for approval before running:
```
git commit -m "Add Look Up User Emails card to admin page"
```

---

## Task 4: Wire the lookup handler in admin.js

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/admin.js` (append new handlers at end of file, after the existing `reset-btn` handler that ends at line 124)

- [ ] **Step 1: Add the click handler, Enter-key binding, and render logic**

Append to `admin.js`:

```javascript

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
                const email = document.createElement('div');
                email.className = 'fw-semibold';
                email.textContent = row.email;
                const userId = document.createElement('small');
                userId.className = 'text-muted';
                userId.textContent = 'userId: ' + row.userId;
                item.appendChild(email);
                item.appendChild(userId);
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
```

- [ ] **Step 2: Manual verification in the browser**

Serve the site locally and sign in as a sysAdmin. Perform each of the following checks; confirm each before moving on:

1. Empty name → click "Look Up" → yellow warning alert "Please enter a name.", no network call (check the Network tab).
2. Name matching exactly one registered user → green success alert "Found 1 user." and a row showing email + userId.
3. Name matching multiple registered users → green success alert with count, one row per user.
4. Name that doesn't match anything → blue info alert "No registered users found with that name."
5. Name matching only unregistered users (users with no `authId`) → blue info alert (same empty state).
6. Press Enter inside the input → same as clicking the button.
7. While loading → button is disabled and shows "Looking up..."; returns to "Look Up" after completion.

If any step fails, fix in place and re-verify.

- [ ] **Step 3: Commit**

```
cd /Users/orrie/code/squabbit_web && git add admin.js && git status
```
Show the user the diff and ask for approval before running:
```
git commit -m "Wire admin email lookup by name handler"
```

---

## Task 5: Deploy and end-to-end verify

**Files:** none modified in this task.

- [ ] **Step 1: Deploy the cloud function**

Ask the user for approval before deploying. Then run:
```
cd /Users/orrie/code/squabbit_cloud && firebase deploy --only functions:getUserEmailsByName
```
Expected: successful deploy output. On failure, run `firebase functions:log` and address the error.

- [ ] **Step 2: Verify against production**

Have the user load the live `admin.html` (signed in as sysAdmin). Repeat verification steps 2–5 from Task 4 against real production data:
- A known registered user's name → confirm the correct email is returned.
- A name shared by multiple users → confirm all registered matches appear.
- A made-up name → confirm the empty-state message.
- A non-sysAdmin account (if available) → confirm `permission-denied` surfaces as an `alert-danger`.

- [ ] **Step 3: Report results to the user**

Summarize what was tested and what passed. If anything failed, stop and surface it rather than marking the feature complete.
