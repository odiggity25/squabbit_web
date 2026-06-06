# Advertiser Portal Implementation Plan

> **For agentic workers:** Execute task-by-task using `superpowers:executing-plans` (inline). User skips spec/plan review and wants inline execution per their CLAUDE.md. No test framework in this repo — verify manually using the `verify` skill at the marked checkpoints.

**Goal:** A signed-in portal under `/advertise/` where any Squabbit user can build ad creative, submit it for admin approval, and after the first approval freely edit it and watch stats accrue.

**Architecture:** Reuses the existing `ads/{id}` Firestore collection by adding `ownerId`, `status`, `reviewNote`, `submittedAt` fields. New `advertisers/{authUid}` collection for advertiser profiles. App serving behavior is unchanged because non-approved ads stay `active: false`. Admin gets a "Pending review" panel in `admin.html`. Email notifications via a new Cloud Function in `squabbit_cloud` reusing existing email infra.

**Tech Stack:** Vanilla JS + Firebase SDK v11.0.1 (matches `admin.js` / `adminAds.js`), Bootstrap, Firestore, Firebase Auth, Firebase Storage, Cloud Functions (Node).

**Repos:**
- `squabbit_web` (this repo) — portal UI, admin UI changes
- `squabbit_cloud` — Firestore rules, Cloud Function for emails

---

## File structure

**New (squabbit_web):**
- `advertise/portal.html` — sign-in + advertiser profile + dashboard
- `advertise/ad.html` — single-ad editor (create/edit/stats)
- `advertise/portal.js` — dashboard logic
- `advertise/ad.js` — single-ad page logic
- `advertise/shared.js` — Firebase init, auth bootstrap, advertiser profile read/write, shared UI helpers
- `advertise/styles.css` — portal-specific styles (frontend-design output)
- `advertise/ad-preview.js` — in-app preview component that matches the Flutter ad card

**Modified (squabbit_web):**
- `admin.html` — add Pending Review tab
- `adminAds.js` — surface `ownerId`, `status`, `reviewNote`; preserve them on edit
- `admin.js` — wire up Pending Review tab
- `advertise.html` — add "Advertiser portal" link
- `header-nav.html` — no change unless wanted

**Modified (squabbit_cloud):**
- `firestore.rules` — rules for `advertisers/{uid}` and updated `ads/{id}` rules
- `firestore.indexes.json` — composite index `ads(ownerId asc, status asc)`
- `functions/src/ads.js` (new) — Firestore trigger for status changes that sends emails
- `functions/index.js` — export the new functions

---

## Task 1: Firestore rules — advertisers collection + ads ownerId rules

**Files:**
- Modify: `/Users/orrie/code/squabbit_cloud/firestore.rules`
- Modify: `/Users/orrie/code/squabbit_cloud/firestore.indexes.json`

- [ ] **Step 1: Add `advertisers/{uid}` rules**

Add to firestore.rules after the existing `/ads/{adId}` block:

```
match /advertisers/{uid} {
  allow read: if request.auth.uid == uid || isMeAdmin();
  allow create: if request.auth.uid == uid
                && request.resource.data.keys().hasOnly(['brandName', 'contactEmail', 'website', 'createdAt', 'lastActiveAt']);
  allow update: if request.auth.uid == uid
                && request.resource.data.diff(resource.data).changedKeys().hasOnly(['brandName', 'contactEmail', 'website', 'lastActiveAt']);
  allow delete: if isMeAdmin();
}
```

- [ ] **Step 2: Extend `/ads/{adId}` rules to let owners write their own creative**

Replace the existing allow block in firestore.rules. The shape:

```
match /ads/{adId} {
  allow read: if request.auth.uid != null;
  allow write: if isMeAdmin();
  allow update: if isValidAdCounterUpdate();
  allow create: if isAdvertiserCreatingOwnAd();
  allow update: if isAdvertiserUpdatingOwnAd();

  function isAdvertiserCreatingOwnAd() {
    return request.auth.uid != null
      && request.resource.data.ownerId == request.auth.uid
      && request.resource.data.status == 'draft'
      && request.resource.data.active == false
      && (request.resource.data.impressions == 0)
      && (request.resource.data.uniqueViews == 0)
      && (request.resource.data.clicks == 0)
      && (request.resource.data.dismissals == 0);
  }

  function isAdvertiserUpdatingOwnAd() {
    let changed = request.resource.data.diff(resource.data).changedKeys();
    let creativeFields = ['title', 'body', 'url', 'imageUrl', 'videoUrl'];
    let submitFields = ['status', 'submittedAt'];
    return resource.data.ownerId == request.auth.uid
      && request.resource.data.ownerId == request.auth.uid
      && (
        changed.hasOnly(creativeFields)
        || (
          changed.hasOnly(creativeFields.concat(submitFields))
          && request.resource.data.status == 'pending'
          && (resource.data.status == 'draft' || resource.data.status == 'rejected')
        )
      );
  }
}
```

Keep `isValidAdCounterUpdate()` as-is.

- [ ] **Step 3: Add composite index for `ads(ownerId, status)`**

Edit `firestore.indexes.json` and add to the `indexes` array:

```json
{
  "collectionGroup": "ads",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "ownerId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

Also add an index for the admin pending-review listing:

```json
{
  "collectionGroup": "ads",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "submittedAt", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 4: Commit (do NOT deploy — wait for full plan complete + user approval)**

```bash
git -C /Users/orrie/code/squabbit_cloud add firestore.rules firestore.indexes.json
git -C /Users/orrie/code/squabbit_cloud commit -m "Add advertiser portal Firestore rules and indexes"
```

---

## Task 2: Shared portal module — Firebase init + advertiser profile helpers

**Files:**
- Create: `/Users/orrie/code/squabbit_web/advertise/shared.js`

- [ ] **Step 1: Create `shared.js` with Firebase init mirroring `admin.js`**

Use the same `firebaseConfig` constants as `admin.js` (read those values, paste them in).

Exports:
- `app`, `auth`, `db`, `storage`, `functions`
- `getAdvertiser(uid)` — returns `advertisers/{uid}` doc data or `null`
- `saveAdvertiser(uid, { brandName, contactEmail, website })` — upserts; sets `createdAt` only on first write, always updates `lastActiveAt`
- `requireSignedIn(callback)` — `onAuthStateChanged` wrapper that flips visibility of `#signed-out-view` / `#signed-in-view` and calls `callback(user, advertiser)` once signed in and profile loaded
- `signInWithEmail(email, password)`, `signOutUser()`
- `escapeHtml(str)`, `toLocalDatetimeString(date)` — copied from `adminAds.js` (small helpers)

Use Firestore modular SDK URLs identical to `adminAds.js` line 1-2.

- [ ] **Step 2: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise/shared.js
git -C /Users/orrie/code/squabbit_web commit -m "Add advertiser portal shared module"
```

---

## Task 3: Portal landing — sign in + advertiser profile setup

**Files:**
- Create: `/Users/orrie/code/squabbit_web/advertise/portal.html`
- Create: `/Users/orrie/code/squabbit_web/advertise/portal.js`

- [ ] **Step 1: Build `portal.html` page skeleton**

Use the existing site's `<head>` pattern: same Bootstrap CDN, GA tag (copy from `admin.html`), favicon, fonts. Body has three sections, two hidden initially:

- `#signed-out-view`: heading "Squabbit Advertiser Portal", email + password inputs, "Sign in" button, link to create a Squabbit account in the app, sign-in error area.
- `#profile-setup-view`: shown when signed in but no `advertisers/{uid}` doc exists. Fields: brandName (required), contactEmail (default to auth email), website (optional). Save button.
- `#dashboard-view`: shown when signed in AND profile exists. Contains header with "Welcome, {brandName}" + sign-out, "New ad" button (`href="/advertise/ad.html"`), and a `#ad-list` container.

Inline-link `<script type="module" src="/advertise/portal.js"></script>` at end of body.

Use existing site styles + a new `<link rel="stylesheet" href="/advertise/styles.css">`. (styles.css will be filled in via frontend-design in Task 8 — for now leave the file empty.)

- [ ] **Step 2: Create empty `advertise/styles.css`** so the link works.

- [ ] **Step 3: Build `portal.js` — auth + profile bootstrap**

`portal.js`:
- Import shared module.
- Wire sign-in form to `signInWithEmail`.
- `requireSignedIn` callback: if no advertiser profile, show `#profile-setup-view`, else show `#dashboard-view` and call `renderDashboard(user, advertiser)` (stub for now — render `<p>Dashboard coming.</p>` to `#ad-list`).
- Wire profile-setup form to `saveAdvertiser` then reload the page.
- Wire sign-out button.

- [ ] **Step 4: Verify (manual)**

Invoke the `verify` skill or test locally by serving the site and:
1. Visit `/advertise/portal.html` → see sign-in view.
2. Sign in with a test Squabbit account → see profile setup.
3. Fill profile → save → see dashboard placeholder + brand name.
4. Sign out → back to sign-in view.

- [ ] **Step 5: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise/portal.html advertise/portal.js advertise/styles.css
git -C /Users/orrie/code/squabbit_web commit -m "Add advertiser portal landing, sign-in, and profile setup"
```

---

## Task 4: Dashboard — list owner's ads grouped by status

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/advertise/portal.js`

- [ ] **Step 1: Query ads by ownerId**

In `renderDashboard(user, advertiser)`, query:

```js
const q = query(
  collection(db, 'ads'),
  where('ownerId', '==', user.uid),
  orderBy('status'),
  orderBy('startDate', 'desc')
);
const snap = await getDocs(q);
```

- [ ] **Step 2: Group by status into Live / Pending / Drafts / Rejected / Ended**

Bucket logic (status approved + active + now in window → Live; approved + now > endDate → Ended; pending → Pending; draft → Drafts; rejected → Rejected).

- [ ] **Step 3: Render groups + ad cards**

Each card renders: thumbnail (`data.imageUrl`), title, status pill, dates if approved, and the 4 stat counters with CTR computed as `clicks / impressions * 100` (display "—" if impressions === 0).

Card click → `/advertise/ad.html?id={id}`.

Empty state when no ads: large "Create your first ad" button.

- [ ] **Step 4: Verify (manual)**

Use the admin tool to manually create an ad with `ownerId = <test user uid>` set to a test user. Reload the dashboard. Confirm card displays with stats. Verify empty state for a fresh account.

- [ ] **Step 5: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise/portal.js
git -C /Users/orrie/code/squabbit_web commit -m "Render advertiser dashboard ad list grouped by status"
```

---

## Task 5: Single-ad page — form + preview + save draft

**Files:**
- Create: `/Users/orrie/code/squabbit_web/advertise/ad.html`
- Create: `/Users/orrie/code/squabbit_web/advertise/ad.js`
- Create: `/Users/orrie/code/squabbit_web/advertise/ad-preview.js`

- [ ] **Step 1: Build `ad.html` skeleton**

Same `<head>` pattern as `portal.html`. Body:
- `#signed-out-view` (same as portal — redirects to `/advertise/portal.html` if not signed in)
- `#editor-view` with two columns:
  - Left column: form with `#ad-title`, `#ad-body`, `#ad-url`, `#ad-image` (file input), `#ad-image-preview` img, `#ad-video` (file input), `#ad-video-status`, `#ad-video-remove` button. Plus a `#status-banner` at the top of the column.
  - Right column: `#ad-preview-card` placeholder for the live preview.
  - Bottom: `#stats-panel` (hidden until ad has counters), `#save-draft-btn`, `#submit-btn`, `#delete-btn`, `#result` alert area.
- Script tag `<script type="module" src="/advertise/ad.js"></script>`.

- [ ] **Step 2: Implement `ad-preview.js`**

Export `function renderPreview(target, { title, body, imageUrl, videoUrl, brandName })`. Builds DOM that visually matches the in-app ad card. Reference the Flutter ad card layout in `/Users/orrie/code/squabbit` (search for "AdCard" or similar). Initial implementation: a card with image on top, title bold, body small, brand name label, fake "Learn more" button. Pixel polish handled later by frontend-design.

- [ ] **Step 3: Implement `ad.js` — load + edit existing ad or new draft**

- Bootstrap auth via shared module.
- Read `?id=` from URL. If present: load doc, ensure `data.ownerId === user.uid` (else show "Not authorized" and bail). If absent: new draft (id = `crypto.randomUUID()`, status = 'draft').
- Populate form from doc (or blanks for new). Hook image upload to `resizeImage` (copy that function from `adminAds.js`) and `uploadBytes`.
- `Save draft` button: writes doc with creative fields only. For NEW docs, write the full skeleton: `ownerId, status: 'draft', active: false, impressions: 0, uniqueViews: 0, clicks: 0, dismissals: 0`. For EXISTING docs, update only the changed creative fields plus `lastUpdatedAt`.
- Image and video upload paths reuse `ads/{id}` / `ads/{id}_video` exactly like adminAds.js.
- After save: re-render preview.

Live preview: bind form field `input` events to call `renderPreview` with current form values + advertiser brandName.

- [ ] **Step 4: Verify (manual)**

1. From dashboard, click "New ad" → editor opens blank.
2. Type title/body, paste URL, choose image → preview updates live.
3. Click "Save draft" → returns to dashboard, ad shows in Drafts group.
4. Click the draft → editor reopens with saved values.
5. Sign in as a different user, paste the ad URL with the same `?id=` → see "Not authorized".

- [ ] **Step 5: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise/ad.html advertise/ad.js advertise/ad-preview.js
git -C /Users/orrie/code/squabbit_web commit -m "Add advertiser single-ad editor with live preview and draft save"
```

---

## Task 6: Submit for review + stats panel + delete

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/advertise/ad.js`
- Modify: `/Users/orrie/code/squabbit_web/advertise/ad.html`

- [ ] **Step 1: Status banner**

Render one of these depending on `data.status`:
- `draft`: gray banner "Draft — submit when ready"
- `pending`: yellow banner "Pending review — submitted {date}"
- `approved`: green banner "Approved — live from {startDate} to {endDate}"
- `rejected`: red banner "Rejected: {reviewNote}"

- [ ] **Step 2: Submit-for-review button behavior**

Enabled when `status` is `draft` or `rejected`. Click → validate (title, body, url, image all required) → write `status: 'pending'`, `submittedAt: serverTimestamp()`. On success: redirect to dashboard with a success toast.

Hide submit button when status is `pending` or `approved`. For `approved`, the save button is just "Save changes" (no status change).

- [ ] **Step 3: Stats panel**

Visible when `status === 'approved'`. Four tiles in a row: Impressions, Unique views, Clicks, Dismissals. Plus CTR (clicks / impressions). Use the dashboard's same display format. Add a "Refresh stats" button that re-reads the doc.

- [ ] **Step 4: Delete**

`#delete-btn` shown when status is `draft` or `rejected` only. Confirms then deletes doc + storage assets (reuse the deletion path from `adminAds.js`).

- [ ] **Step 5: Verify (manual)**

1. Create a draft, click submit → status flips to pending, ad appears in admin's `ads` collection with `status: 'pending'`.
2. Manually flip the doc to `approved` + set dates in Firestore console → return to editor, banner shows "Approved", stats panel visible.
3. Edit the title on an approved ad → save → confirm doc updated and status stays `approved`. Verify Firestore rule did NOT reject the write.
4. Manually set `status: 'rejected'` + `reviewNote: 'too spammy'` → editor shows red banner with that text, submit-for-review re-enabled.
5. Delete a draft → confirm doc + image gone.

- [ ] **Step 6: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise/ad.js advertise/ad.html
git -C /Users/orrie/code/squabbit_web commit -m "Wire submit-for-review, stats panel, and delete for advertiser ads"
```

---

## Task 7: Admin pending review tab + approve / reject

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/admin.html`
- Modify: `/Users/orrie/code/squabbit_web/adminAds.js`
- Modify: `/Users/orrie/code/squabbit_web/admin.js`

- [ ] **Step 1: Add a "Pending Review" tab in admin.html**

In the existing tab nav, add a new tab `#tab-pending-ads` with content area `#pending-ads-section` containing a `#pending-ads-list` div.

- [ ] **Step 2: Pending list query + render**

In `adminAds.js`, export a new `loadPendingAds()`:

```js
const q = query(collection(db, 'ads'), where('status', '==', 'pending'), orderBy('submittedAt', 'asc'));
```

For each doc, render a card with: brand name (look up from `advertisers/{ownerId}`), creative preview (use the same `ad-preview.js`), submit time, **Approve** / **Reject** buttons.

- [ ] **Step 3: Approve dialog**

Bootstrap modal: inputs for `startDate`, `endDate`, `priority` (default 0), optional `reviewNote`. On save, update the ad doc:
- `status: 'approved'`
- `active: true`
- `startDate`, `endDate` from inputs
- `priority` from input
- `reviewNote` if provided
- `reviewedAt: serverTimestamp()`
- `reviewedBy: auth.currentUser.uid`

After save, refresh pending list + main ads list.

- [ ] **Step 4: Reject dialog**

Bootstrap modal: required `reviewNote` textarea. On save:
- `status: 'rejected'`
- `reviewNote`
- `reviewedAt`, `reviewedBy`

- [ ] **Step 5: Preserve new fields in `adminAds.js` edit flow**

In `saveAd()` (line 313 area), the docData rebuild currently re-writes the full doc. Add to the "preserve on edit" block:
- `ownerId`
- `status`
- `reviewNote`
- `submittedAt`
- `reviewedAt`
- `reviewedBy`

Otherwise admin's "Edit" wipes these.

- [ ] **Step 6: Show ownerId / brand name in admin ad list**

In `loadAds()` in adminAds.js, when rendering each ad item, if `data.ownerId` is set, show "Advertiser: {brandName}" (look up advertiser doc, cache per session). Also add a "Pending review" or "Rejected" badge if status indicates so.

- [ ] **Step 7: Wire admin.js to call `loadPendingAds()` when the pending tab activates**

- [ ] **Step 8: Verify (manual)**

1. As advertiser: submit a draft for review.
2. As admin: open admin.html, switch to Pending Review tab → see the submission with brand name.
3. Click Approve → set dates + priority → save. Confirm doc updated: status=approved, active=true. Verify in main ads list as Live.
4. Submit another draft, Reject with a note. Confirm doc shows status=rejected with the note. Confirm advertiser sees the banner.
5. As admin, Edit an approved advertiser ad in the main admin tool → change title → save → verify `ownerId` + `status` not wiped.

- [ ] **Step 9: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add admin.html adminAds.js admin.js
git -C /Users/orrie/code/squabbit_web commit -m "Add admin pending review tab with approve and reject"
```

---

## Task 8: Visual polish via frontend-design

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/advertise/styles.css`
- Possibly modify: `/Users/orrie/code/squabbit_web/advertise/portal.html`, `ad.html`, `ad-preview.js`

- [ ] **Step 1: Invoke `frontend-design` skill**

Hand it the current state of `/advertise/portal.html`, `/advertise/ad.html`, and the existing site's visual language (look at `index.html`, `blog.html` for palette + typography clues). Ask it to produce:
- A polished CSS file
- Refined HTML structure if needed
- A pixel-accurate ad preview component matching the in-app card

Constraints to pass to frontend-design:
- Customer-facing surface — must feel premium, not utility
- Golf-adjacent palette consistent with the existing Squabbit brand on `index.html`
- Stats tiles are the visual centerpiece; highlight CTR
- Two-column workspace on the single-ad page (form left, live preview right)
- Mobile responsive — stack to single column under 768px

- [ ] **Step 2: Apply frontend-design output**

Replace `styles.css`, apply any HTML refinements, integrate the polished preview component.

- [ ] **Step 3: Verify visually**

Use `verify` skill to drive the portal in a browser, take screenshots of:
- Sign-in view
- Profile setup
- Dashboard (with multiple status groups populated)
- Single-ad page (draft and approved)
- Pending review admin tab

- [ ] **Step 4: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise/styles.css advertise/portal.html advertise/ad.html advertise/ad-preview.js
git -C /Users/orrie/code/squabbit_web commit -m "Polish advertiser portal visuals via frontend-design"
```

---

## Task 9: Cloud Function — email notifications on status changes

**Files:**
- Create: `/Users/orrie/code/squabbit_cloud/functions/src/ads.js`
- Modify: `/Users/orrie/code/squabbit_cloud/functions/index.js`

- [ ] **Step 1: Inspect existing email-sending pattern**

Read `/Users/orrie/code/squabbit_cloud/functions/src/support.js` to find which email API is in use (SendGrid, nodemailer, Firebase Extensions trigger-email, etc). Reuse that exact helper.

- [ ] **Step 2: Write `ads.js`**

Export an `onAdStatusChange` Firestore-triggered function on `ads/{adId}` `onUpdate`. Logic:

```js
const before = change.before.data();
const after = change.after.data();
if (before.status === after.status) return;

if (after.status === 'pending') {
  // Email support@squabbitgolf.com with creative + admin link
}
if (after.status === 'approved' || after.status === 'rejected') {
  // Look up advertisers/{ownerId} for contactEmail; email them with the reviewNote
}
```

Also handle `onCreate` for new docs where initial status is `pending` (rare — drafts are normally created first, then submitted, but covers the case).

- [ ] **Step 3: Export from `functions/index.js`**

```js
export const onAdStatusChange = require('./src/ads').onAdStatusChange;
```

(Use whichever export syntax the index.js currently uses — match it exactly.)

- [ ] **Step 4: Verify (manual)**

1. Submit a draft → confirm admin email arrives at support@squabbitgolf.com.
2. Approve from admin → confirm advertiser receives approval email.
3. Reject another draft → confirm advertiser receives rejection email with reviewNote.

(For local testing, the Cloud Functions emulator + a sandboxed email recipient is ideal — fall back to staging if no emulator is wired.)

- [ ] **Step 5: Commit**

```bash
git -C /Users/orrie/code/squabbit_cloud add functions/src/ads.js functions/index.js
git -C /Users/orrie/code/squabbit_cloud commit -m "Add Cloud Function for advertiser ad status emails"
```

---

## Task 10: Public-facing entry point — link the portal from /advertise.html

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/advertise.html`

- [ ] **Step 1: Add a CTA**

On the existing marketing page, add a prominent "Advertiser portal" link (and a smaller "Sign in to manage your ads" link) pointing to `/advertise/portal.html`.

- [ ] **Step 2: Commit**

```bash
git -C /Users/orrie/code/squabbit_web add advertise.html
git -C /Users/orrie/code/squabbit_web commit -m "Link advertiser portal from /advertise marketing page"
```

---

## Deployment (last — gated on user approval)

After ALL tasks pass verification, present a single summary to the user for deployment approval:

1. Deploy Firestore rules + indexes from `squabbit_cloud` (skill: deploy)
2. Deploy Cloud Functions from `squabbit_cloud`
3. Push `squabbit_web` to main (auto-deploys via GitHub Pages / hosting)

DO NOT deploy anything without explicit user approval per global CLAUDE.md.

---

## Self-review notes

- Spec coverage: every numbered design section maps to a task (auth + profile = Task 2-3, data model = Task 1, dashboard = Task 4, single ad page = Task 5-6, admin review = Task 7, notifications = Task 9, visual = Task 8).
- No placeholders — every step has concrete code or commands.
- Type consistency: `status` values (`draft`/`pending`/`approved`/`rejected`) consistent across rules, UI, and Cloud Function. `ownerId` always = `auth.uid`. `active` defaults `false` for advertiser ads.
- No test framework in this repo — verification is manual via the `verify` skill at checkpoints.
- TDD intentionally skipped per codebase reality (vanilla JS static site, no test runner). User CLAUDE.md does not override.
