---
name: game-format-article
description: Use when creating a help article for a golf game format or scoring type. Covers the full process - HTML article creation, SEO metadata, articles.json entry, and group page link.
---

# Game Format Help Article

Creates SEO-optimized help articles for golf game formats and scoring types.

## Process

1. **Research** the format in `/Users/orrie/code/squabbit/` - read the scoring class, GameScoringType.dart description, handicap settings, team size limits, subscoring options, and any variants.
2. **Create directory** at `help/groups/gamesAndFormats/articles/<formatName>/`
3. **Write the HTML article** following the template below.
4. **Add entry to `articles.json`** with title and search tags (include all alternate names).
5. **Add link to group page** `help/groups/gamesAndFormats/gamesAndFormatsGroup.html` under the correct category (Individual games or Team games).
6. **Run `node build.js`** to inline nav/footer.

## Article HTML Template

Use the Scramble article as the reference implementation:
`help/groups/gamesAndFormats/articles/scramble/scramble.html`

Every article MUST include:

### Head
- `<title>` format: `{Format Name} Golf Format - Rules, Scoring & How to Play | Squabbit`
- `<meta name="description">` with keyword-rich summary
- `<meta name="keywords">` with all alternate names and common search terms
- Canonical URL, Open Graph, and Twitter Card metadata
- Standard stylesheets: Bootstrap 5, Outfit font, bootstrap-icons, nav.css, article.css
- Inline `<style>` block with: `.toc`, `.section` (collapsible details), `.at-a-glance`, `.note-box`, `.example-block` styles (copy from scramble article)

### Body Structure
1. **H1** - format name
2. **"Also known as"** line - all alternate names (if any)
3. **Intro paragraph** - 2-3 sentences explaining what makes this format distinctive, targeting SEO keywords naturally
4. **At a Glance card** - quick-reference dl with: Type (Individual/Team), Players/Team size, Scoring options, Handicaps, Wins (lowest score / highest points / most holes)
5. **Table of Contents** - `.toc` nav linking to collapsible sections
6. **Collapsible sections** using `<details class="section">`:
   - **The Rules** (open by default) - numbered list of how to play
   - **Example** - concrete walkthrough of a hole or round
   - **Variants** (if any) - describe all variations from the code
   - **Scoring Options** (if multiple) - explain each supported subscoring type
   - **Handicap Options** (if applicable) - explain handicap settings, percentages, net/gross
   - **Setting Up in Squabbit** - step-by-step app instructions
7. **TOC scroll script** - opens collapsed section and scrolls to it

### SEO Guidelines
- Title tag should include the format name + "golf" + action words people search for
- Include ALL alternate names in the "Also known as" line, meta keywords, and articles.json tags
- Write the intro paragraph to naturally include phrases like "how to play [format]", "[format] golf rules"
- Use h2/h3 headings with descriptive text (not just "Rules" but "The Rules" or "How [Format] Scoring Works")

### Nav and Footer
Copy the nav and footer HTML from the scramble article exactly. The build script will keep them updated.

## articles.json Entry Format

```json
{
  "title": "{Format name} golf format",
  "file": "/help/groups/gamesAndFormats/articles/{formatName}/{formatName}.html",
  "tags": ["tag1", "tag2", "alternate name", "team/individual", "format", "game"]
}
```

## Group Page

The group page `gamesAndFormatsGroup.html` uses a card grid layout. Each format is an `<a class="format-card">` with:
- `data-search` attribute containing all alternate names and keywords for the search filter
- `.card-title` div with the format name and an arrow icon
- `.card-desc` paragraph with a one-line description
- `.card-aliases` div (if applicable) with "Also: ..." alternate names

Cards are organized under three sections (General, Individual Games, Team Games) and **sorted alphabetically** within each section. When adding a new card, insert it in the correct alphabetical position.

If a category heading doesn't exist yet, create it.

## Key Source Files in Flutter App

| File | What it contains |
|------|-----------------|
| `lib/games/GameScoringType.dart` | Descriptions, team sizes, handicap defaults, subscoring options |
| `lib/games/team/*.dart` or `lib/games/individual/*.dart` | Scoring logic and rules |
| `lib/tournament/format/**/*.dart` | Tournament format wrappers |
| `lib/handicap/HandicapSettings.dart` | Handicap configuration structure |
