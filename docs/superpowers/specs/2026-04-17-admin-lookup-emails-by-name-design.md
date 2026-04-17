# Admin: Look Up User Emails by Name

## Goal

Add a section to the admin page that, given a user's name, returns the email addresses of all registered users whose Firestore `users` doc has that exact name.

## Why

Admins sometimes need to contact a user but only know their in-app display name, not their email. Today there's no way to go from name → email without direct database access.

## Scope

- **In scope:** exact-match name lookup for registered users only.
- **Out of scope:** case-insensitive / partial / substring matching; looking up unregistered (pending-invite) users; any UI beyond a minimal input + results list.

## Architecture

Three pieces:

1. **Cloud function** `getUserEmailsByName` in `/Users/orrie/code/squabbit_cloud/functions/src/users.js`, exported from `/Users/orrie/code/squabbit_cloud/functions/index.js`.
2. **HTML section** in `/Users/orrie/code/squabbit_web/admin.html` (new Bootstrap card below the existing "Reset User Credentials" card).
3. **Client logic** in `/Users/orrie/code/squabbit_web/admin.js` (event handler, callable invocation, result rendering).

## Cloud function: `getUserEmailsByName`

**Signature:** `httpsCallable` that takes `{ name: string }`.

**Steps:**

1. Require `context.auth`; otherwise throw `unauthenticated`.
2. Verify the caller is a sysAdmin using the same pattern as `resetUserCredentials` / `getUserEmail`: find the caller's user doc via `authId == context.auth.uid`, then check membership in `configs/squabbitConfig.sysAdmins`. Throw `permission-denied` otherwise.
3. Validate `name` is a non-empty string. Throw `invalid-argument` otherwise.
4. Query `users` where `name == <input>`.
5. For each doc:
   - Skip if `authId` is missing (unregistered).
   - Call `admin.auth().getUser(authId)`. On failure for an individual user, log and skip that user (do not fail the whole request).
   - Collect `{ userId: doc.id, email: authUser.email }` only if `email` is present.
6. Return `{ results: [...] }`.

**Export:** add `getUserEmailsByName` to the existing combined export line in `index.js`:
```
export { deleteProfile, onUserCreated, userUpdated, resetUserCredentials, getUserEmail, getUserEmailsByName, verifySysAdmin } from './src/users.js';
```

## UI: admin.html

Add a new `card shadow-sm p-4 mt-4` immediately after the "Reset User Credentials" card:

- `<h5>Look Up User Emails</h5>`
- Short muted helper line: "Find registered users by their in-app name (exact match)."
- Alert placeholder: `<div id="lookup-result" class="alert d-none"></div>`
- Input: `<input id="lookup-name" class="form-control" type="text" />` with label "User Name"
- Button: `<button id="lookup-btn" class="btn btn-primary w-100">Look Up</button>`
- Results container: `<div id="lookup-list"></div>`

Results render as a list styled like the existing patterns — one row per match with two lines:
- Line 1 (prominent): email
- Line 2 (muted small): `userId: <id>`

No styling additions needed beyond what Bootstrap already provides.

## Client logic: admin.js

- Add an event listener on `#lookup-btn` click.
- Trim the name; if empty, show a warning in `#lookup-result` and return.
- Disable the button, set its text to "Looking up…", clear previous results.
- Call `httpsCallable(functions, 'getUserEmailsByName')({ name })`.
- On success:
  - If `results.length === 0`: show an info alert "No registered users found with that name."
  - Else: render each result into `#lookup-list` and show a success alert with the count (e.g. "Found 2 users").
- On error: show `alert-danger` with the message.
- Wire `Enter` key on `#lookup-name` to click the button (match the login field pattern).
- Clear any previous alert / list at the start of each lookup.

## Data flow

```
admin.html input
  → admin.js click handler
  → httpsCallable('getUserEmailsByName', { name })
  → Cloud Function
      → sysAdmin check
      → firestore users where name == input
      → for each: admin.auth().getUser(authId)
      → { results: [{ userId, email }] }
  → admin.js renders list
```

## Error handling

- Unauthenticated / non-sysAdmin → surfaced as error alert.
- Empty input → client-side warning; no server call.
- Zero matches → empty-state message, not an error.
- Individual auth lookup failure → logged server-side, user omitted from results. The request still succeeds.
- Network / unknown errors → `alert-danger` with `e.message`.

## Testing (manual)

1. Sign in as sysAdmin; enter a known name → verify the correct email(s) appear.
2. Enter a name that matches multiple users → verify all are listed.
3. Enter a name that matches only unregistered users (no `authId`) → verify empty state.
4. Enter a name with no matches → verify empty state.
5. Sign in as a non-sysAdmin (if testable) → verify permission-denied.
6. Empty input → verify the warning and no network call.
