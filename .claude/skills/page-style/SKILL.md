---
name: page-style
description: Use when creating or updating any help page, article page, or content page on the Squabbit website. Defines the standard layout, colors, typography, hover effects, and page structure that all pages must follow.
---

# Page Style

Standard design system for all Squabbit website pages.

Reference implementations:
- **Group / landing pages:** `help/groups/gamesAndFormats/gamesAndFormatsGroup.html`
- **Article pages:** `help/groups/league/articles/recreatingATournamentFromAnotherApp/recreatingATournamentFromAnotherApp.html`

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

---

# Article Pages

Long-form help articles (single page, scrollable content) use a **card-style layout** that visually matches the group pages. Reference: `help/groups/league/articles/recreatingATournamentFromAnotherApp/recreatingATournamentFromAnotherApp.html`.

## Article Structure

```
1. Nav bar (copy from any existing page)
2. Back-to-group link (.back-link-wrap → .back-link)
3. Article wrapper (.article-wrap → <article class="article-card">)
   a. Article header: optional badge pill, h1 (centered)
   b. Body: paragraphs, h2/h3 sections, lists, images, tables, note boxes
4. Footer spacer + footer
```

Do NOT use `article.css` — articles use inline `<style>` blocks like the group pages. The page-style skill is the source of truth.

## Article Stylesheet (copy-paste)

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet" />
<link href="/css/nav.css" rel="stylesheet">
<style>
    body {
        font-family: 'Outfit', sans-serif;
        background: #fafbfa;
        color: #1a1a1a;
    }
    .back-link-wrap {
        max-width: 760px;
        margin: 0 auto;
        padding: 90px 16px 0;
    }
    .back-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #329543;
        text-decoration: none;
        font-size: .92rem;
        font-weight: 500;
    }
    .back-link:hover { color: #28a745; text-decoration: none; }
    .article-wrap {
        max-width: 760px;
        margin: 0 auto;
        padding: 16px;
    }
    .article-card {
        background: #fff;
        border: 1px solid #e8ede9;
        border-radius: 18px;
        padding: 48px 56px 56px;
        box-shadow: 0 8px 28px rgba(50, 149, 67, .04);
    }
    .article-header {
        text-align: center;
        margin-bottom: 32px;
    }
    .article-header .badge-pill {
        display: inline-block;
        background: linear-gradient(135deg, #329543, #28a745);
        color: #fff;
        font-weight: 700;
        font-size: .78rem;
        padding: 5px 14px;
        border-radius: 20px;
        letter-spacing: .04em;
        margin-bottom: 16px;
        text-transform: uppercase;
    }
    .article-header h1 {
        font-size: 2.4rem;
        font-weight: 800;
        color: #1a1a1a;
        letter-spacing: -.02em;
        margin: 0 0 12px;
        line-height: 1.15;
    }
    .article-card h2 {
        font-size: 1.35rem;
        font-weight: 700;
        color: #1a1a1a;
        letter-spacing: -.01em;
        margin: 40px 0 14px;
        padding-top: 8px;
        position: relative;
    }
    .article-card h2::before {
        content: '';
        display: block;
        width: 36px;
        height: 3px;
        background: linear-gradient(90deg, #329543, #28a745);
        border-radius: 2px;
        margin-bottom: 14px;
    }
    .article-card h3 {
        font-size: 1.05rem;
        font-weight: 700;
        color: #1a1a1a;
        margin: 28px 0 10px;
    }
    .article-card p {
        font-size: 1rem;
        line-height: 1.65;
        color: #333;
        margin: 0 0 14px;
    }
    .article-card ul {
        font-size: 1rem;
        line-height: 1.65;
        color: #333;
        padding-left: 22px;
        margin: 0 0 16px;
    }
    .article-card ul li { margin-bottom: 6px; }
    .article-card a {
        color: #329543;
        text-decoration: none;
        font-weight: 600;
    }
    .article-card a:hover { text-decoration: underline; }
    .article-card code {
        font-family: 'SFMono-Regular', Menlo, monospace;
        font-size: .88em;
        background: #f0f9f1;
        color: #1e7a4a;
        padding: 2px 7px;
        border-radius: 5px;
    }
    .article-img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 14px;
        box-shadow: 0 6px 24px rgba(0,0,0,.08);
        margin: 20px auto;
    }
    .nav-path {
        display: inline-block;
        font-size: .9rem;
        color: #1e7a4a;
        background: #f0f9f1;
        padding: 3px 10px;
        border-radius: 6px;
        font-family: 'Outfit', sans-serif;
        font-weight: 600;
    }
    .nav-path .sep { color: #99c5a3; margin: 0 4px; }
    .note-box {
        background: #fffbf0;
        border: 1px solid #f0dfa0;
        border-left: 4px solid #e0b840;
        border-radius: 10px;
        padding: 16px 20px;
        margin: 20px 0;
        font-size: .95rem;
        line-height: 1.6;
        color: #5a4400;
    }
    .note-box strong { color: #8a6d00; }
    @media (max-width: 576px) {
        .article-card { padding: 32px 22px 40px; border-radius: 14px; }
        .article-header h1 { font-size: 1.8rem; }
        .article-card h2 { font-size: 1.2rem; margin-top: 32px; }
    }
</style>
```

## Article Body Markup

```html
<div class="back-link-wrap">
    <a href="/help/groups/<group>/<group>Group.html" class="back-link">
        <i class="bi bi-arrow-left"></i> Back to <Group Name>
    </a>
</div>

<div class="article-wrap">
    <article class="article-card">
        <div class="article-header">
            <span class="badge-pill"><Group Name> Article</span>  <!-- optional -->
            <h1>Article Title</h1>
        </div>

        <p>Lead paragraph...</p>

        <h2>Section heading</h2>
        <p>Section body...</p>

        <img class="article-img" src="images/foo.webp" alt="..." style="max-width: 360px; max-height: 500px; width: auto;">
    </article>
</div>
<div style="margin-bottom: 120px;"></div>
```

## Article Components

| Component | When to use |
|-----------|-------------|
| `.badge-pill` | Optional pill above h1 — use the group name (e.g. `League Article`, `Tournament Article`) |
| `.nav-path` | Inline code-like chip for menu paths (e.g. `Settings → Other → Import tournaments`) |
| `.note-box` | Tips, warnings, callouts. Yellow with left border accent |
| `code` | Inline code, column names, file names |
| `.article-img` | Standard screenshot. Tall portrait phone shots add `max-width: 360px; max-height: 500px; width: auto;` |
| Custom tables | Define inline as needed but follow tokens (green headers on `#f0f9f1`, `1px solid #e8ede9` borders, rounded `12px` corners) |

## Article Width

Articles use `max-width: 760px` (narrower than the 932px group pages) for comfortable reading line length.
