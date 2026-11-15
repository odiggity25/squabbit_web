# Ideas split-panel (master-detail) Implementation Plan

**Goal:** Tapping an idea on `ideas.html` opens it in a right-side panel (desktop) / full-screen slide-over (mobile) instead of navigating to `idea.html`, so there is no page reload, scroll is preserved, and the list card's status/vote updates live.

**Architecture:** Extract the detail logic from `js/idea.js` into a reusable controller `js/ideaDetail.js`. The standalone `idea.html` page and the new `ideas.html` panel both drive the same controller. The list hosts the controller, syncs the active card from controller callbacks, and manages open/close + browser history.

**Tech stack:** Vanilla ES modules, Firebase web SDK (Firestore/Functions/Storage), Bootstrap 5 shell, no build/test harness (static GitHub Pages site). Verify manually in a browser.

## Global constraints
- No em dashes anywhere.
- Keep `idea.html` working as a deep-link fallback (existing shared links, e.g. merge redirects).
- Don't regress: filters, infinite scroll, scroll restoration, submit modal, voting, comments, admin bar.

## File structure
- Create `js/ideaDetail.js` — `createIdeaDetail({ root, lightbox, lightboxImg, onCardSync, onMerged, onDeleted })` → `{ open(id), close(), setUser(ctx) }`. Holds its own state + watcher unsubscribes.
- Rewrite `js/idea.js` — thin bootstrap: build ctx from auth, drive the controller against `#detail-root`, redirect on merge/delete.
- Edit `ideas.html` — split layout wrapper, `#idea-panel`, lightbox, panel header with close.
- Edit `js/ideas.js` — open/close panel, pushState/popstate, deep-link `?id=`, add isSysAdmin to ctx, `onCardSync` patches `state.ideas`/`state.voted` + re-renders the one card; card click opens panel instead of navigating; submit success opens panel.
- Edit `css/ideas.css` — two-column split, sticky panel, mobile overlay slide-over, active-card highlight.

## Tasks
### Task 1: Extract controller `js/ideaDetail.js`
Move render/vote/comment/admin/merge/delete logic out of idea.js into a factory. Watchers re-subscribe per `open(id)` (unsubscribe previous). `setUser(ctx)` updates user/userDocId/userProfile/isSysAdmin and re-renders. Fire `onCardSync(id, patch)` from watchIdeaDoc (voteCount/status/commentCount/title/category) and from the vote handler (voteCount/voted). `onMerged(targetId)`, `onDeleted(id)` delegate navigation to host. Use shared `showToast`.

### Task 2: Thin `js/idea.js`
Standalone page uses the controller; behavior identical to today (merge/delete redirect to `/idea.html` / `/ideas.html`).

### Task 3: `ideas.html` layout
Add `.ideas-split` wrapper around list + `#idea-panel`; add lightbox markup; panel has a header with back/close.

### Task 4: `ideas.js` wiring
Card click → openIdea(id); pushState `?id=`; popstate opens/closes; deep-link on load; ctx gains isSysAdmin; onCardSync updates card in place (add `data-id` to card); submit success opens panel; empty-panel placeholder when nothing selected.

### Task 5: CSS
Desktop two-column (list left, sticky panel right, widen container when open); mobile overlay slide-over; active card highlight; respect reduced motion; keyboard focus on close.

## Verification (manual)
Serve the dir, load `ideas.html`: tap an idea → panel opens, URL gains `?id=`, back button closes instantly with scroll kept. As sysadmin, change status → card badge updates live. Vote in panel → card count/highlight updates. Deep-link `ideas.html?id=X` opens with panel. Narrow viewport → full-screen slide-over. `idea.html?id=X` still works standalone.
