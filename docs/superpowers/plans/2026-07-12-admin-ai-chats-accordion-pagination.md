# Admin AI Chats Accordion + Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI chats table + separate detail page with an inline-expanding accordion list, paginated server-side (25/page, Next/Prev).

**Architecture:** Single static admin page (adminAiChats.html + adminAiChats.js, Firebase modular SDK v11). The list query already fetches full documents including `messages`, so accordion expansion renders from in-memory data with no extra fetch. Pagination uses Firestore `limit(PAGE_SIZE + 1)` + `startAfter(cursor)` with a cursor stack for Prev. `?id=` deep link fetches that single doc and renders it as one pre-expanded accordion item with a "Show all conversations" link.

**Tech Stack:** Vanilla JS ES modules, Bootstrap 5.3 (accordion component), Firebase Firestore modular SDK.

## Global Constraints

- No em dashes in code comments or copy.
- Keep sysAdmin auth gate untouched.
- Page is noindex admin-only; no build.js step applies (page has no shared nav/footer placeholders).
- Deploy = push to main (do NOT push without user approval; "cp" triggers it).

---

### Task 1: HTML restructure (adminAiChats.html)

**Files:**
- Modify: `adminAiChats.html`

**Interfaces:**
- Produces DOM ids consumed by Task 2: `chats-accordion`, `pager`, `prev-page-btn`, `next-page-btn`, `page-indicator`, `show-all-link`, `list-result`, `chat-search`.

- [ ] Remove the `<table class="chats-table">` block and the entire `#detail-view` div.
- [ ] Add inside the list card: `<div class="accordion accordion-flush" id="chats-accordion"></div>` plus a pager row below it with Prev/Next buttons and a page indicator; add a hidden `#show-all-link` ("&larr; Show all conversations") above the card for deep-link mode.
- [ ] Replace table CSS with accordion styles (header grid columns for title/type/msgs/counts/updated, transcript panel background) following frontend-design guidance; keep existing chat-bubble/status-chip/actions-block styles.

### Task 2: JS accordion + pagination (adminAiChats.js)

**Files:**
- Modify: `adminAiChats.js`

- [ ] Add `PAGE_SIZE = 25`, `pageCursors = []` (stack of last-doc snapshots per loaded page), `currentPage = 0`, `hasNextPage`.
- [ ] `loadPage(pageIndex)`: query `orderBy('updatedAt','desc'), limit(PAGE_SIZE + 1)` with `startAfter(pageCursors[pageIndex - 1])` when pageIndex > 0; the +1 doc detects `hasNextPage` and is not rendered; store the cursor for the rendered page's last doc; keep full `data()` per row so expansion is local.
- [ ] `renderAccordion(rows)`: one accordion item per conversation; header button contains the summary line (title, group type, #msgs, proposed/applied chips, updated); body is lazily filled on first `show.bs.collapse` with detail facts + transcript (reuse existing `renderDetailHeader` facts + `renderTranscript`).
- [ ] Pager wiring: Next loads `currentPage + 1`, Prev re-runs `loadPage(currentPage - 1)`; disable buttons appropriately; indicator "Page N".
- [ ] Search box filters the current page's rows client-side (title/groupId), re-rendering the accordion.
- [ ] `?id=` deep link: `getDoc` the single conversation, render it as a single expanded accordion item, hide pager/search, show `#show-all-link`.
- [ ] Delete now-unused detail-view code paths.

### Task 3: Verify

- [ ] `node --check adminAiChats.js` passes (syntax only; ES module).
- [ ] Manual: open page locally (python http.server), sign in, confirm accordion expands inline, Next/Prev work, `?id=` deep link expands, search filters.
