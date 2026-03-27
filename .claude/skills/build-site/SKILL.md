---
name: build-site
description: Use when editing header-nav.html, footer-content.html, or creating new HTML pages. Inlines shared nav and footer into all site pages.
user-invocable: true
allowed-tools: Bash, Read
---

# Build Site

Inlines `header-nav.html` and `footer-content.html` into all public-facing HTML pages.

## When to Run

- After editing `header-nav.html` (the shared nav bar)
- After editing `footer-content.html` (the shared footer)
- After creating a new HTML page that includes the nav/footer
- After running the `blog-post` skill

## Usage

```bash
node build.js
```

The script is idempotent — safe to re-run anytime. It replaces both placeholder divs (`id="header-placeholder"`) and previously inlined nav/footer content.

## Key Files

| File | Purpose |
|------|---------|
| `header-nav.html` | Source of truth for the nav bar |
| `footer-content.html` | Source of truth for the footer |
| `build.js` | Reads partials, inlines into all pages |

## Excluded from Build

`index.html`, `branding.html`, `privacyPolicy.html`, `admin.html`, `stripeCheckout.html`, `stripeCheckoutLoading.html`, `accountDeletion.html`, and `help/groups/_template/` files are skipped.

## Adding a New Page

New pages can either:
1. Use placeholder divs (`<div id="header-placeholder"></div>`) — the build script will replace them
2. Copy the `<nav>` and footer from any existing page — the build script will keep them updated
