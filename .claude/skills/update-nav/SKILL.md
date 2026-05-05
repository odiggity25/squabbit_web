---
name: update-nav
description: Use when adding, removing, or renaming entries in the site nav (`header-nav.html`) — covers the manual second step required for pages that build.js excludes (index.html, advertise.html, branding.html, privacyPolicy.html), plus running `node build.js` for everything else.
allowed-tools: Read, Edit, Bash
---

# Updating the Site Nav

`header-nav.html` is the single source of truth for the nav, but **`node build.js` does NOT update every page**. A handful of pages are excluded and must be edited by hand.

## Two steps, in order

### 1. Edit `header-nav.html` and run the build

```bash
node build.js
```

This inlines the new nav into every non-excluded HTML page in the repo.

### 2. Manually update each excluded page that has the standard nav

The build excludes pages whose layouts are custom *or* whose nav uses self-referential anchor links (e.g. `#features` for smooth in-page scrolling). Skipping the build keeps those behaviors. Excluded pages with a visible standard nav:

| File | Notes |
|------|-------|
| `index.html` | Uses in-page anchors (`#features`, `#testimonials`, etc.). Replacing with absolute paths (`/index.html#features`) breaks smooth-scroll on the home page itself (browser treats it as a full navigation). |
| `branding.html`, `privacyPolicy.html`, `advertise.html` | Standalone pages with the standard nav. Verify each has the same `<ul class="navbar-nav">` block before editing. |

For each, find the `<ul class="navbar-nav">` block and add/remove the `<li class="nav-item">` to match `header-nav.html`. Anchor href style stays as-is in each file (don't convert in-page anchors to absolute paths in `index.html`).

Pages excluded for *other* reasons (no standard nav at all): `admin.html`, `stripeCheckout.html`, `stripeCheckoutLoading.html`, `accountDeletion.html`. These don't need manual nav updates.

## Sanity check

After both steps:
```bash
grep -L "your-new-nav-link-href" *.html | grep -vE "header.html|footer.html|header-nav.html|footer-content.html|admin.html|stripeCheckout|accountDeletion|README"
```
Anything that prints (other than pages without nav at all) is a page you missed.

## Why not just remove pages from EXCLUDED_FILES in build.js?

Tempting, but the in-page anchor regression on `index.html` is real and visible (loses smooth-scroll, brief reload flash on home-page nav clicks). The exclusion list intentionally protects those behaviors. Manual touch on a small set of pages is the lesser evil.
