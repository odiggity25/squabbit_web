# Ad Analytics, Event Log & Server-Side Serving — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give advertisers an activity log and a per-day views/clicks graph for their ad, move view/unique/click tracking to a server-authoritative model keyed by user uid, and move ad selection (eligibility + frequency cap + rotation) to the server.

**Architecture:** Server-authoritative counting via a callable `recordAdEvent` that bumps lifetime counters (back-compat with old clients) and per-day + per-uid records. An `onWrite` trigger diffs ad docs into an `events` subcollection (full audit, audience-tagged). The advertiser web portal renders the log + a Chart.js graph from per-day docs. A callable `getAdFill` returns a server-ranked, cap-filtered, dismissal-filtered ordered list of ad ids; new app clients render from that list. A remote-config kill-switch falls clients back to the old client-side query.

**Tech Stack:** Firebase Cloud Functions (Node, `firebase-functions/v1`, `node --test` + `firebase-functions-test`), Firestore (+ TTL policies), vanilla-JS web portal (ESM from gstatic CDN, Bootstrap), Chart.js via CDN, Flutter (Dart) app.

**Repos:**
- Functions/rules: `/Users/orrie/code/squabbit_cloud`
- Web portal/admin: `/Users/orrie/code/squabbit_web`
- Flutter app: `/Users/orrie/code/squabbit`

**Deploys are gated** — every `firebase deploy` / app release requires explicit user approval. Plan implements + tests locally; surfaces deploy points.

---

## Shared data model (locked, referenced by all phases)

Ad doc `ads/{id}` keeps existing lifetime counters: `impressions`, `uniqueViews`, `clicks`, `dismissals` (authoritative headline totals; bumped by BOTH old `incrementCounter` and new `recordAdEvent`).

New subcollections:
- `ads/{id}/days/{YYYY-MM-DD}` → `{ impressions, uniqueViews, clicks, dismissals }` (per-day totals; the graph's source).
- `ads/{id}/days/{YYYY-MM-DD}/viewers/{uid}` → `{ count }` (per-uid per-day view count; `count===1` transition drives daily unique; `count` drives the frequency cap). **TTL** on a `expireAt` field, ~60 days.
- `ads/{id}/viewers/{uid}` → `{ firstAt }` (lifetime per-uid membership; `create` transition drives lifetime unique). No TTL.
- `ads/{id}/dismissedBy/{uid}` → `{ at }` (durable; excludes ad from this user's fill). No TTL.
- `ads/{id}/events/{autoId}` → `{ type, at, actor, audience, details }` (activity log / audit).

Date key = UTC `YYYY-MM-DD` (server-computed; consistent with how counters run). `expireAt` = day + 60d.

Event entry shape:
`type`: `created | creativeUpdated | submitted | approved | rejected | paused | resumed | scheduleChanged | nowPublic | priorityChanged | previewUsersChanged | enteredPreview | misc`
`actor`: `advertiser | admin | system`
`audience`: `advertiser | admin`
`details`: type-specific (e.g. `{ fields:['title','imageUrl'] }`, `{ startDate, endDate }`, `{ note }`).

Remote config (Firestore `config/squabbit` or existing SquabbitConfig doc): `maxAdViewsPerDay` (exists, =2), new `serverAdSelection` (bool kill-switch; false ⇒ clients use legacy client-side query).

---

## PHASE A — Event log (server + web; no app release)

**Files:**
- Modify: `/Users/orrie/code/squabbit_cloud/functions/src/ads.js` (extend `onAdStatusChange` → general diff-and-log; keep existing emails).
- Create: `/Users/orrie/code/squabbit_cloud/functions/src/adEvents.js` (pure diff→events mapper, unit-testable).
- Create: `/Users/orrie/code/squabbit_cloud/functions/test/adEvents.test.js`.
- Create: `/Users/orrie/code/squabbit_cloud/scripts/backfillAdEvents.mjs` (one-time milestone backfill).
- Modify: `/Users/orrie/code/squabbit_web/advertise/ad.js` (render advertiser-visible events in a timeline panel).
- Modify: `/Users/orrie/code/squabbit_web/advertise/ad.html` (timeline container + styles hook).
- Modify: `/Users/orrie/code/squabbit_web/adminAds.js` (admin: show full event list incl. admin-audience rows in the edit view).
- Modify: `/Users/orrie/code/squabbit_cloud/firestore.rules` (`events` read: owner-or-admin; write: server only).

- [ ] **A1: Pure mapper `diffAdToEvents(before, after, context)` → Event[]** — unit test first (`test/adEvents.test.js`): created (before null), creativeUpdated with changed `fields`, submitted/approved/rejected from status, paused/resumed from `active`, scheduleChanged from start/end, nowPublic from `internalPreview` true→false, priority/previewUsers → admin audience. Run `node --test`, see fail, implement `adEvents.js`, pass, commit.
- [ ] **A2: Wire into `onAdStatusChange`** — rename intent to general `onAdWrite` (keep export name to avoid breaking deploy aliases OR add new export + remove old; check `index.js` export). After existing email logic, compute `diffAdToEvents` and batch-write entries to `ads/{id}/events`. Guard: skip pure counter-only writes (changedKeys ⊆ {impressions,uniqueViews,clicks,dismissals,lastUpdatedAt}) so analytics writes don't spam the log. Commit.
- [ ] **A3: Rules** — `match /ads/{id}/events/{e}` allow read if `isMeAdmin() || isOwner`; allow write: if false (server only). Deploy rules (GATED).
- [ ] **A4: Portal timeline UI** — in `ad.js`, after load, query `events` where `audience=='advertiser'` orderBy `at` desc, render a vertical timeline (label + relative date + detail). Neutral phrasing map. Hide for admin-preview? show. Follow existing status-banner styling.
- [ ] **A5: Admin event list** — in `adminAds.js` edit/open form, list all events (both audiences) for the ad.
- [ ] **A6: Backfill script** — `backfillAdEvents.mjs` (firebase-admin + ADC, `GOOGLE_CLOUD_QUOTA_PROJECT=squabbit-2019`): for each ad, if no events exist, seed from `createdAt`→created, `submittedAt`→submitted, `reviewedAt`/`startDate`→approved. Idempotent. Run against prod (GATED).
- [ ] **A7: Deploy functions** (GATED) + verify on Golfbreaks ad.

---

## PHASE B — Server analytics foundation (`recordAdEvent`) (functions + app)

**Files:**
- Create: `/Users/orrie/code/squabbit_cloud/functions/src/adRecord.js` (`recordAdEvent` callable + pure helpers).
- Create: `/Users/orrie/code/squabbit_cloud/functions/test/adRecord.test.js`.
- Modify: `/Users/orrie/code/squabbit_cloud/functions/index.js` (export `recordAdEvent`).
- Modify: `firestore.rules` (`days`, `viewers`, `dismissedBy` reads: owner-or-admin; writes: server only).
- Create: Firestore TTL policy on `days/*/viewers` `expireAt` (via gcloud/console; GATED).
- Modify Flutter: `lib/feed/FeedRepository.dart`, `lib/feed/FeedManager.dart`, `lib/feed/AdFeedWidget.dart` (replace increment calls with `recordAdEvent`; drop local unique flag; keep local per-day cap counter + `_impressionRecorded` guard).

- [ ] **B1: Pure helpers unit-tested** — `dateKeyUTC(date)`, `expireAtFor(dateKey)`. Test + implement + commit.
- [ ] **B2: `recordAdEvent({adId, type})` callable** — auth required; `type∈{impression,click,dismissal}`; uid from `context.auth.uid`. Transaction/batched:
  - impression: ad `impressions`+1; day `impressions`+1; viewers/uid `count`+1 → if was absent: ad `uniqueViews`+1 (first-ever via `ads/{id}/viewers/{uid}` create) & day `uniqueViews`+1.
  - click: ad `clicks`+1; day `clicks`+1.
  - dismissal: ad `dismissals`+1; day `dismissals`+1; set `dismissedBy/{uid}`.
  Validate adId exists. Unit test with `firebase-functions-test` offline + emulator-style admin mock. Commit.
- [ ] **B3: Rules + TTL** — add subcollection rules; create TTL policy on viewers `expireAt`. Deploy (GATED).
- [ ] **B4: Flutter switch** — add `FeedRepository.recordAdEvent(adId, type)` calling the callable; in `AdFeedWidget` impression path call `recordAdEvent(id,'impression')` (remove `recordUniqueAdView` + `adUniqueViewRecorded_*`); clicks→`'click'`; dismissals→`'dismissal'`. Keep `adViews_{id}_{date}` local cap counter and `_impressionRecorded`. Update widget tests. Commit.
- [ ] **B5: Verify** mixed-fleet: old path (`incrementCounter`) still bumps lifetime totals; new path bumps lifetime + per-day. App release (GATED, separate).

---

## PHASE C — Portal graph + log polish (web only)

**Files:**
- Modify: `/Users/orrie/code/squabbit_web/advertise/ad.html` (Chart.js CDN, canvas, legend toggles).
- Modify: `/Users/orrie/code/squabbit_web/advertise/ad.js` (load `days/*`, build series, render chart with markers).
- Create: `/Users/orrie/code/squabbit_web/advertise/ad-chart.js` (chart module: takes per-day series + event markers, renders).

- [ ] **C1: Data load** — query `ads/{id}/days` ordered by id; map to arrays {date, impressions, uniqueViews, clicks}. Fill gap days with 0.
- [ ] **C2: Chart** — `ad-chart.js` renders line chart: impressions (total), unique views, clicks (secondary axis). Chart.js via CDN ESM. Follow portal color tokens.
- [ ] **C3: Markers/shading** — overlay from events + ad fields: "went live" (derived from `startDate`), "ended" (`endDate`), paused/resumed spans (from `paused`/`resumed` events) as shaded gaps; vertical annotation lines for approved/creativeUpdated.
- [ ] **C4: Empty/partial state** — "Daily breakdown available from <first day doc date>" note for the mixed-fleet gap. Show lifetime totals headline above the chart (existing stats panel).
- [ ] **C5: Manual verify** in browser via admin `viewAs` for Golfbreaks.

---

## PHASE D — Server-side selection (`getAdFill`) (functions + app)

**Files:**
- Create: `/Users/orrie/code/squabbit_cloud/functions/src/adFill.js` (`getAdFill` callable + pure ranking).
- Create: `/Users/orrie/code/squabbit_cloud/functions/test/adFill.test.js`.
- Modify: `index.js` (export `getAdFill`).
- Modify Flutter: `lib/feed/FeedRepository.dart` (call `getAdFill`, cache list), `lib/feed/FeedManager.dart` (consume server fill when `serverAdSelection` on; else legacy path), `lib/utils/SquabbitConfig/SquabbitConfig.dart` (read `serverAdSelection`).

- [ ] **D1: Pure ranking unit-tested** — `rankAds(ads, {dismissedIds, viewCounts, maxPerDay, now, version})`: filter active+in-window+version+not-dismissed+under-cap; order by `priority` desc then stable-random within tier (seed by uid+date for determinism). Test + implement + commit.
- [ ] **D2: `getAdFill({version})` callable** — auth required; load eligible ads (mirror current Firestore query), this uid's `dismissedBy` set + today's `days/{date}/viewers/{uid}` counts; return `[{adId, remainingToday}]` via `rankAds`. Honor `previewUserIds` bypass. Unit test. Commit.
- [ ] **D3: Flutter consume** — `FeedRepository.getAdFill()` returns cached ordered list per session/refresh; `FeedManager` uses it when `serverAdSelection` true, walking the list + decrementing `remainingToday` locally, still recording via `recordAdEvent`; falls back to legacy client query when kill-switch off or call fails. Tests. Commit.
- [ ] **D4: Kill-switch** — `serverAdSelection` in config; verify toggling falls back. App release (GATED).

---

## Self-review notes
- Type consistency: event `type`/`actor`/`audience` enums defined once above; `recordAdEvent` `type` enum {impression,click,dismissal} distinct from event-log `type`. Per-uid per-day doc field is `count` (used by both unique-on-1 and cap<max). Lifetime membership doc `ads/{id}/viewers/{uid}` create-transition = lifetime unique. These names are reused verbatim in B2/D2.
- Back-compat: lifetime counters never sourced from per-day docs; both client generations write lifetime totals. Graph reads per-day only (partial during rollout — handled C4).
- Gated actions flagged inline (rules deploy, functions deploy, TTL policy, backfill run, app releases).
