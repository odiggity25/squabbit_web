# Admin: Fix Signup Email — Design

## Problem

Users sometimes sign up with the wrong email address (typo, used a personal address instead of work, etc.) and then can't log in because they've also forgotten their password. Today we have `resetUserCredentials`, which clears credentials and sets `pendingEmail` to the auth user's *own* email — that doesn't help here, because the email itself is wrong.

We want a sysAdmin tool that takes both the incorrect email (where the user accidentally signed up) and the correct email (where they want their account), and fixes it so the user can sign up with the correct email and have it auto-link to their existing Firestore profile via the existing `pendingEmail` flow.

## Solution Overview

Add a new cloud function `removeIncorrectEmailAndAssignNewPendingEmail` that mirrors `resetUserCredentials`'s cleanup pattern but uses a caller-supplied email for `pendingEmail` instead of the auth user's own email. Add a corresponding card to the admin web tool with a confirmation dialog before execution.

## Cloud Function: `removeIncorrectEmailAndAssignNewPendingEmail`

Location: `squabbit_cloud/functions/src/users.js`. Exported from `squabbit_cloud/functions/index.js` alongside the other user-management functions.

**Signature:** `functions.https.onCall(async (data, context) => …)`

**Inputs:** `{ incorrectEmail: string, correctEmail: string }`

**Returns:** `{ success: true, userId: string, pendingEmail: string }`

### Step-by-step behavior

1. **Auth check.** If `!context.auth`, throw `unauthenticated`.
2. **sysAdmin check.** Find the caller's user doc via `users.where('authId', '==', context.auth.uid).limit(1)`. Look up `configs/squabbitConfig.sysAdmins`. If the caller's userId isn't in the list, throw `permission-denied`. (Same pattern as `resetUserCredentials`.)
3. **Input validation.**
    - Both fields must be non-empty strings.
    - Trim and lowercase both before any comparison or lookup.
    - If the two emails are equal after normalization, throw `invalid-argument` with message "incorrectEmail and correctEmail must differ".
4. **Look up incorrect-email auth user.**
    - `await admin.auth().getUserByEmail(incorrectEmail)`.
    - On `auth/user-not-found` (or any failure), throw `not-found` with a message including the incorrect email.
    - Capture the returned `uid` as `authId`.
5. **Collision check on correct email.**
    - `await admin.auth().getUserByEmail(correctEmail)` inside a try/catch.
    - If it succeeds, throw `already-exists` with message "Correct email already has an auth account — resolve manually".
    - If it throws `auth/user-not-found`, proceed. Re-throw any other error.
6. **Find the Firestore user doc.**
    - `users.where('authId', '==', authId).limit(1).get()`.
    - If empty, throw `not-found` with message "No user doc found with authId for incorrect email".
7. **Mutate Firestore *before* deleting auth user.**
    ```js
    await userRef.update({
      pendingEmail: correctEmail,
      authId: admin.firestore.FieldValue.delete(),
      registered: false,
    });
    ```
   This is critical: the `deleteProfile` trigger (`functions.auth.user().onDelete`) deletes any user doc whose `authId` matches the deleted auth uid. Clearing `authId` first prevents the trigger from wiping the doc we just fixed.
8. **Delete the auth user.** `await admin.auth().deleteUser(authId)`. Now the user can sign up with the correct email and the existing pending-email auto-link flow will reattach them to the same Firestore doc.
9. **Log + return** `{ success: true, userId, pendingEmail: correctEmail }`.

### Error model

All errors surface to the admin UI as `Error: <message>`. Specific cases:

| Case                                                       | Code                | Notes                                            |
| ---------------------------------------------------------- | ------------------- | ------------------------------------------------ |
| Caller not signed in                                       | `unauthenticated`   |                                                  |
| Caller is not a sysAdmin                                   | `permission-denied` |                                                  |
| Missing/empty inputs                                       | `invalid-argument`  |                                                  |
| Both emails equal                                          | `invalid-argument`  | Message names the duplicate.                     |
| Incorrect email has no auth account                        | `not-found`         | Includes the incorrect email in the message.     |
| Correct email already has an auth account                  | `already-exists`    | Admin must resolve duplicate accounts manually.  |
| No Firestore user doc with the matching authId             | `not-found`         | Should be rare — implies the doc was already deleted. |

The Firestore update in step 7 and the auth delete in step 8 are not transactional. If step 8 fails, the Firestore doc has been mutated but the auth user still exists. This matches the existing `resetUserCredentials` behavior; it's acceptable because retrying step 8 manually is straightforward, and the alternative (transactional rollback) doesn't exist for `admin.auth()` operations.

## Admin UI

### HTML changes (`squabbit_web/admin.html`)

Add a new Bootstrap card inside `#admin-tools`, placed between the existing "Reset User Credentials" card and the "Look Up User Emails" card. Same `card shadow-sm p-4 mt-4` styling as siblings.

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

### JS changes (`squabbit_web/admin.js`)

Append a new click handler near the existing `reset-btn` and `lookup-btn` handlers. Behavior:

1. Read and trim both inputs.
2. If either is empty, show a yellow `alert-warning` in `#fix-signup-result` and return.
3. Show a `confirm()` dialog:
   `"Delete the auth account for {incorrectEmail} and set pendingEmail to {correctEmail}? This cannot be undone."`
   If the admin cancels, return without changes.
4. Disable the button, change its text to `"Fixing..."`.
5. Call `httpsCallable(functions, 'removeIncorrectEmailAndAssignNewPendingEmail')({ incorrectEmail, correctEmail })`.
6. On success: green `alert-success` showing `"Signup email fixed. pendingEmail set to {correctEmail}."`; clear both inputs.
7. On error: red `alert-danger` showing `"Error: " + (e.message || e)`.
8. In `finally`: re-enable the button, restore label.

This mirrors the existing `reset-btn` handler's loading/result/finally pattern.

## Data Flow

```
Admin enters (incorrectEmail, correctEmail)
        │
        ▼
admin.js: validate, confirm()
        │
        ▼
httpsCallable('removeIncorrectEmailAndAssignNewPendingEmail')
        │
        ▼
Cloud function:
   sysAdmin check
   getUserByEmail(incorrectEmail)  ──► authId
   getUserByEmail(correctEmail)    ──► must NOT exist
   users.where(authId == ...)      ──► userDoc
   userDoc.update({ pendingEmail: correctEmail,
                    authId: delete,
                    registered: false })
   admin.auth().deleteUser(authId)
        │
        ▼
return { success, userId, pendingEmail }
        │
        ▼
admin.js: show success alert, clear inputs

(later, organic flow)
User signs up with correctEmail
        │
        ▼
Existing onUserCreated / pendingEmail auto-link flow
attaches the new auth account to the existing Firestore doc.
```

## Files touched

- `squabbit_cloud/functions/src/users.js` — add `removeIncorrectEmailAndAssignNewPendingEmail` export
- `squabbit_cloud/functions/index.js` — add `removeIncorrectEmailAndAssignNewPendingEmail` to the export list from `./src/users.js`
- `squabbit_web/admin.html` — add the new card
- `squabbit_web/admin.js` — add the button click handler

## Out of scope

- Bulk fixes (one user at a time only).
- Showing a preview of the affected user before commit (the `confirm()` dialog is sufficient).
- Recovering when both emails already have separate auth accounts (the function blocks; admin handles manually).
- Audit logging beyond the standard `console.log` line that other admin functions use.

## Testing

There is no JS test infrastructure in `squabbit_cloud`. Verification will be manual, matching the pattern used for `resetUserCredentials`, `getUserEmail`, and `getUserEmailsByName`:

- Emulator smoke test against a seeded user.
- Production verification using a real sysAdmin account on a known fix request.
