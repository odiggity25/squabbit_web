---
name: page-style
description: Use when creating or updating any help page, article page, or content page on the Squabbit website. Defines the standard layout, colors, typography, hover effects, and page structure that all pages must follow.
---

# Page Style

Standard design system for all Squabbit website pages. Reference implementation: `help/groups/gamesAndFormats/gamesAndFormatsGroup.html`.

## Page Structure

```
1. Nav bar (copy from any existing page — build.js keeps it updated)
2. Back to Help link
3. Page header (optional badge, h1, subtitle)
4. Search bar (only if 5+ articles)
5. Section label(s) with divider line and count
6. Card grid(s)
7. No-results message (only if search bar present)
8. Footer spacer + footer (copy from any existing page)
```

## Design Tokens

| Token | Value |
|-------|-------|
| Font | `'Outfit', sans-serif` — weight 400–800 |
| Background | `#fafbfa` |
| Text primary | `#1a1a1a` |
| Text secondary | `#666` |
| Text muted | `#777` |
| Brand green | `#329543` |
| Green gradient | `linear-gradient(135deg, #329543, #28a745)` |
| Green light bg | `#f0f9f1` |
| Card border | `#e8ede9` |
| Card border hover | `#c8deca` |
| Section line | `linear-gradient(90deg, #e2ebe4, transparent)` |
| Search border | `2px solid #e2ebe4` |
| Search focus ring | `0 0 0 4px rgba(50, 149, 67, .1)` |
| Card hover shadow | `0 8px 28px rgba(50, 149, 67, .1)` |
| Max content width | `932px` |
| Card min width | `270px` (grid: `repeat(auto-fill, minmax(270px, 1fr))`) |
| Card border radius | `14px` |
| Card padding | `22px 24px 20px` |
| Grid gap | `16px` |

## Back to Help Link

Positioned above the header inside a `max-width: 932px` container with `padding: 90px 16px 0` (clears fixed nav).

```html
<div style="max-width: 932px; margin: 0 auto; padding: 90px 16px 0;">
    <a href="/help.html" style="display: inline-flex; align-items: center; gap: 6px; color: #329543; text-decoration: none; font-size: .92rem; font-weight: 500; font-family: 'Outfit', sans-serif;">
        <i class="bi bi-arrow-left"></i> Back to Help
    </a>
</div>
```

## Page Header

Centered. Optional badge, then h1 (2.6rem / 800 weight), then subtitle paragraph.

```html
<div class="page-header" style="padding-top: 16px;">
    <span class="format-count">BADGE TEXT</span>  <!-- optional -->
    <h1>Page Title</h1>
    <p>One or two sentences describing the page.</p>
</div>
```

Badge guidelines:
- Use for pages with 5+ articles (e.g. `35+ FORMATS`, `10 ARTICLES`)
- Use for special categories (e.g. `QUICK START`)
- Omit for pages with fewer than 5 articles

## Search Bar

Include only when the page has 5 or more articles.

```html
<div class="search-wrap">
    <i class="bi bi-search search-icon"></i>
    <input type="text" id="formatSearch" placeholder="Search articles..." autocomplete="off">
</div>
```

When search is present, each card needs a `data-search` attribute with extra keywords, and each section label and grid needs a matching `data-section` attribute. Include the search/filter JS at the bottom (see reference implementation).

## Section Labels

```html
<div class="section-label" data-section="sectionId">
    <h2>Section Name</h2>
    <div class="section-line"></div>
    <span class="section-count">N</span>
</div>
```

- `data-section` only needed when search is present
- Use uppercase text via CSS (`text-transform: uppercase; letter-spacing: .06em`)
- First section margin-top is `16px` (reduced from default `48px` since it follows header); subsequent sections use `48px`

## Card Component

```html
<a href="/path/to/article.html" class="format-card" data-search="extra keywords">
    <div class="card-title">Card Title <i class="bi bi-arrow-right arrow"></i></div>
    <p class="card-desc">One to two sentence description of what the article covers.</p>
    <div class="card-aliases">Also: Alternate Name</div>  <!-- optional -->
</a>
```

Hover behavior:
- Card lifts 3px (`translateY(-3px)`)
- Green left border animates in (`scaleY(0) → scaleY(1)`)
- Arrow fades in and slides right
- Box shadow appears

Animation: All cards use `fadeUp` (opacity 0→1, translateY 16→0) with staggered delay of `0.03s * index`.

## Special Card Variant

For cards that don't fit neatly into a section category, use the `.general-card` class which adds a gold left border and removes the green hover bar:

```html
<a href="..." class="format-card general-card">
```

## Responsive

At `max-width: 576px`:
- h1 drops to `2rem`
- Grid switches to single column

## Stylesheets

These pages use **inline `<style>` blocks** — they do NOT use `article.css`. Required external sheets:
- Bootstrap 5.1.3
- Outfit font (weights 400, 500, 600, 700, 800)
- Bootstrap Icons 1.11.3
- `/css/nav.css`

## Button Overrides

```css
.btn-primary {
    color: #fff;
    background-color: #329543;
    border-color: #329543;
}
.btn-primary:hover {
    color: #fff;
    background-color: #232fcc;
    border-color: #212cc0;
}
```

## Quick Reference

| Articles | Badge | Search | Sections |
|----------|-------|--------|----------|
| 1–4 | No | No | Single "Articles" section |
| 5–9 | Yes | No | Group by category if natural split exists |
| 10+ | Yes | Yes | Group by category with `data-section` attributes |
