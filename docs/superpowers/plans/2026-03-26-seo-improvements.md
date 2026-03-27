# SEO Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical SEO issues across the Squabbit website to improve search engine ranking for "golf tournament software" and related queries.

**Architecture:** Create a Node.js build script that inlines header/footer HTML into all pages (replacing the current JS fetch pattern). Add SEO meta tags, structured data, and expand the sitemap — all as direct HTML edits.

**Tech Stack:** Node.js (build script), HTML, JSON-LD structured data

---

## File Structure

**Create:**
- `build.js` — Build script that inlines header/footer partials into all pages
- `header-nav.html` — Nav-only partial extracted from current header.html (just the `<nav>` element)
- `footer-content.html` — Footer-only partial extracted from current footer.html (just the `<footer>` and spacer)

**Modify:**
- `blog.html` — Add meta tags, OG tags, fix blog thumbnail alt text
- `help.html` — Add meta tags, OG tags, fix multiple H1 tags
- `supportSquabbit.html` — Add meta tags
- `blog/entries/11languages/11languages.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/importScoresWithAI/importScoresWithAI.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/simulatorRounds/simulatorRounds.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/eliminationFormats/eliminationFormats.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/scorecardMarkers/scorecardMarkers.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/publicLeaderboards/publicLeaderboards.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/originStory/originStory.html` — Add meta tags + BlogPosting JSON-LD
- `blog/entries/autoScheduler/autoSchedulerArticle.html` — Add meta tags + BlogPosting JSON-LD
- `help/groups/tournament/tournamentsGroup.html` — Add meta tags
- `help/groups/league/leaguesGroup.html` — Add meta tags
- `help/groups/club/clubsGroup.html` — Add meta tags
- `help/groups/gettingStarted/gettingStartedGroup.html` — Add meta tags
- `help/groups/account/accountGroup.html` — Add meta tags
- `help/groups/gamesAndFormats/gamesAndFormatsGroup.html` — Add meta tags
- All help articles (16 files) — Add meta tags
- `sitemap.xml` — Add missing pages
- `tournament.html` — Add meta tags
- `league.html` — Add meta tags

---

### Task 1: Create header/footer partials and build script

Extract the nav and footer into clean partials, then create a build script that inlines them into all pages that use the fetch() pattern.

**Files:**
- Create: `header-nav.html`
- Create: `footer-content.html`
- Create: `build.js`

- [ ] **Step 1: Create `header-nav.html`**

Extract just the `<nav>` element from `header.html` (lines 13-37). This is the clean partial that will be inlined.

- [ ] **Step 2: Create `footer-content.html`**

Extract just the spacer div and `<footer>` from `footer.html` (lines 10-18).

- [ ] **Step 3: Create `build.js`**

Node.js script that:
1. Reads `header-nav.html` and `footer-content.html`
2. Finds all `.html` files recursively (excluding `header.html`, `footer.html`, `header-nav.html`, `footer-content.html`, `admin.html`, `stripeCheckout.html`, `stripeCheckoutLoading.html`, `accountDeletion.html`, and files in `help/groups/_template/`)
3. For each file that contains `id="header-placeholder"`:
   - Replaces `<div id="header-placeholder"></div>` with the nav HTML
   - Replaces `<div id="footer-placeholder"></div>` with the footer HTML
   - Removes the entire `<script>` block that contains the `fetch('/header.html')` and `fetch('/footer.html')` calls
4. Preserves all other content unchanged

Special cases:
- `help.html` has an `embed` query param check wrapping the fetch calls — the build should still replace the placeholders and remove the fetch block, but preserve the embed-related JS (hideContactIfWeb, contactUsTapped, search functionality)
- `supportSquabbit.html` may have different fetch patterns — handle accordingly

- [ ] **Step 4: Run the build script and verify**

Run `node build.js` and check that:
- Pages load correctly in a browser
- Nav and footer appear in the static HTML (view source)
- No fetch('/header.html') calls remain in built pages
- The `help.html` embed/search JS is preserved

- [ ] **Step 5: Commit**

```
git add header-nav.html footer-content.html build.js
git commit -m "Add build script to inline header/footer partials"
```

---

### Task 2: Add meta tags to blog.html and help.html

**Files:**
- Modify: `blog.html`
- Modify: `help.html`

- [ ] **Step 1: Add meta tags to `blog.html`**

Add to `<head>`:
```html
<meta name="description" content="Read the latest Squabbit news including new features, golf tournament tips, and product updates.">
<link rel="canonical" href="https://www.squabbitgolf.com/blog.html" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://www.squabbitgolf.com/blog.html" />
<meta property="og:title" content="Squabbit Blog - Golf Tournament Software Updates & Tips" />
<meta property="og:description" content="Read the latest Squabbit news including new features, golf tournament tips, and product updates." />
<meta property="og:image" content="https://www.squabbitgolf.com/assets/squabbit_wordmark.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Squabbit Blog - Golf Tournament Software Updates & Tips" />
<meta name="twitter:description" content="Read the latest Squabbit news including new features, golf tournament tips, and product updates." />
<meta name="twitter:image" content="https://www.squabbitgolf.com/assets/squabbit_wordmark.png" />
```

Update title to: `Squabbit Blog - Golf Tournament Software Updates & Tips`

Fix blog thumbnail alt text — replace all generic "Blog Image" alt text with specific descriptions:
- 11languages thumb: "Squabbit available in 11 languages"
- importScoresWithAI thumb: "Import golf scores by taking a photo with AI"
- simulatorRounds thumb: "Golf simulator rounds and handicap tracking"
- eliminationFormats thumb: "Elimination tournament bracket formats"
- scorecardMarkers thumb: "Scorecard markers for golf tournaments"
- publicLeaderboards thumb: "Public golf tournament leaderboard"
- originStory thumb: "The Squabbit origin story - a squirrel rabbit"
- autoScheduler thumb: "Auto scheduler for golf tournament tee times"

- [ ] **Step 2: Add meta tags to `help.html` and fix H1 tags**

Add to `<head>`:
```html
<meta name="description" content="Get help with Squabbit golf tournament and league software. Browse guides on creating tournaments, managing leagues, setting up clubs, and more.">
<link rel="canonical" href="https://www.squabbitgolf.com/help.html" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://www.squabbitgolf.com/help.html" />
<meta property="og:title" content="Squabbit Help - Golf Tournament & League Guides" />
<meta property="og:description" content="Get help with Squabbit golf tournament and league software. Browse guides on creating tournaments, managing leagues, setting up clubs, and more." />
<meta property="og:image" content="https://www.squabbitgolf.com/assets/squabbit_wordmark.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Squabbit Help - Golf Tournament & League Guides" />
<meta name="twitter:description" content="Get help with Squabbit golf tournament and league software. Browse guides on creating tournaments, managing leagues, setting up clubs, and more." />
<meta name="twitter:image" content="https://www.squabbitgolf.com/assets/squabbit_wordmark.png" />
```

Update title to: `Squabbit Help - Golf Tournament & League Guides`

Fix H1 tags — change the "Common issues" and "Contact us" H1 tags to H2:
- `<h1 class="text-center">Common issues</h1>` → `<h2 class="text-center">Common issues</h2>`
- `<h1 class="text-center">Contact us</h1>` → `<h2 class="text-center">Contact us</h2>`

- [ ] **Step 3: Commit**

---

### Task 3: Add meta tags and BlogPosting JSON-LD to all blog entries

**Files:**
- Modify: All 8 blog entry HTML files

- [ ] **Step 1: Add meta tags + JSON-LD to each blog entry**

For each blog entry, add to the `<head>`:
- `<meta name="description" content="...">` (unique per entry)
- `<link rel="canonical" href="https://www.squabbitgolf.com/blog/entries/...">`
- Open Graph tags (og:type="article", og:url, og:title, og:description, og:image)
- Twitter card tags
- `<meta name="author" content="Squabbit">`
- BlogPosting JSON-LD schema

Also fix incorrect titles (e.g., "Getting Started" on originStory and publicLeaderboards).

**Blog entry metadata:**

| Entry | Title | Description | Date | Image |
|-------|-------|------------|------|-------|
| 11languages | Squabbit Now Available in 11 Languages | Squabbit is now fully translated into 11 languages including Deutsch, Espanol, Francais, Italiano, Nederlands, and more. | 2026-03-22 | languages.webp |
| importScoresWithAI | Import Scores by Taking a Photo | Use AI to import golf scores by photographing your scorecard or simulator screen. Squabbit reads the scores automatically. | 2026-03-14 | thumb.webp |
| simulatorRounds | Simulator Rounds and Handicaps | Track indoor golf simulator rounds separately with a dedicated simulator handicap in Squabbit. | 2026-03-13 | thumb.webp |
| eliminationFormats | New Elimination & Team Elimination Formats | Single-elimination brackets for golf tournaments and leagues. Run knockout-style events with Squabbit. | 2026-03-10 | thumb.webp |
| scorecardMarkers | Introducing Scorecard Markers | Assign designated scorekeepers for your golf tournaments with Squabbit's new scorecard markers feature. | 2026-03-09 | thumb.webp |
| publicLeaderboards | Public Leaderboards Are Here | Share your golf tournament leaderboard with anyone — no registration required. Spectators can follow along live. | 2025-08-12 | publicLeaderboard.webp |
| originStory | The Squabbit Origin Story | How a golf trip to Myrtle Beach and some funny-looking squirrels led to the creation of Squabbit golf tournament software. | 2025-03-23 | images/squirrelRabbit.webp |
| autoScheduler | Introducing Auto Scheduler | Create all of your golf tournament matches and tee times in seconds with Squabbit's new auto scheduler. | 2024-12-07 | /blog/thumbs/autoSchedulerThumb.jpg |

**JSON-LD template for each entry:**
```html
<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "[TITLE]",
    "description": "[DESCRIPTION]",
    "image": "https://www.squabbitgolf.com/blog/entries/[FOLDER]/[IMAGE]",
    "datePublished": "[DATE]",
    "author": {
        "@type": "Organization",
        "name": "Squabbit",
        "url": "https://www.squabbitgolf.com"
    },
    "publisher": {
        "@type": "Organization",
        "name": "Squabbit",
        "url": "https://www.squabbitgolf.com",
        "logo": {
            "@type": "ImageObject",
            "url": "https://www.squabbitgolf.com/assets/icon_transparent.png"
        }
    },
    "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "https://www.squabbitgolf.com/blog/entries/[FOLDER]/[FILE]"
    }
}
</script>
```

- [ ] **Step 2: Commit**

---

### Task 4: Add meta tags to help group pages and help articles

**Files:**
- Modify: 6 help group pages + 16 help articles

- [ ] **Step 1: Add meta tags to help group pages**

Each group page gets: description, canonical, OG tags, Twitter tags, and an improved title.

| Page | Title | Description |
|------|-------|------------|
| tournamentsGroup.html | Squabbit Tournament Help - Setup & Management Guides | Learn how to create and manage golf tournaments with Squabbit. Guides on formats, scoring, scheduling, and more. |
| leaguesGroup.html | Squabbit League Help - Setup & Scheduling Guides | Learn how to set up and manage golf leagues with Squabbit. Guides on scheduling events, handicaps, and more. |
| clubsGroup.html | Squabbit Club Help - Create Your Digital Clubhouse | Learn how to create and manage a digital golf clubhouse with Squabbit. |
| gettingStartedGroup.html | Getting Started with Squabbit - Golf Tournament & League Software | New to Squabbit? Learn the basics of setting up tournaments, leagues, and clubs for your golf group. |
| accountGroup.html | Squabbit Account Help - Login, Signup & Troubleshooting | Get help with your Squabbit account including login issues, duplicate accounts, and password resets. |
| gamesAndFormatsGroup.html | Squabbit Games & Formats - Skins, Scramble, Presses & More | Learn about the 30+ golf game formats available in Squabbit including Skins, Scramble, Alternate Shot, and Presses. |

- [ ] **Step 2: Add meta tags to all help articles**

Each article gets: description, canonical, OG tags, Twitter tags, and a corrected title.

| Article | Title | Description |
|---------|-------|------------|
| creatingATournament.html | Creating a Tournament - Squabbit Help | Step-by-step guide to creating a golf tournament on Squabbit including courses, players, formats, and scheduling. |
| addingATeamTournamentFormat.html | Adding a Team Format - Squabbit Help | Learn how to add team formats like Scramble, Best Ball, and Ryder Cup to your Squabbit golf tournament. |
| addingABlind.html | Adding a Blind (Ghost Player) - Squabbit Help | Learn how to add blind or ghost players to your golf tournament teams in Squabbit. |
| invitingPlayersToYourTournamentArticle.html | Inviting Players to Your Tournament - Squabbit Help | Learn how to invite players to join your golf tournament on Squabbit using invite codes and links. |
| roleManagement.html | Role Management - Squabbit Help | Learn how to manage admin and player roles in your Squabbit golf tournament, league, or club. |
| simulatorRounds.html (help) | Simulator Rounds - Squabbit Help | Learn how to track indoor golf simulator rounds and maintain a separate simulator handicap in Squabbit. |
| importingScoresWithAI.html | Importing Scores with AI - Squabbit Help | Learn how to use AI to import golf scores by photographing your scorecard or simulator screen in Squabbit. |
| creatingALeague.html | Creating a League - Squabbit Help | Step-by-step guide to creating a golf league (society) on Squabbit with recurring events and scheduling. |
| creatingAClubArticle.html | Creating a Club - Squabbit Help | Learn how to create a digital golf clubhouse on Squabbit for your course or golf group. |
| whenToChooseGroupType.html | Tournament vs League vs Club - Squabbit Help | Understand when to choose a Tournament, League, or Club in Squabbit for your golf group. |
| registeringForAGroup.html | Registering for a Group - Squabbit Help | Learn how to join a golf tournament, league, or club on Squabbit using an invite code or link. |
| fixingDuplicateUsersArticle.html | Fixing Duplicate Users - Squabbit Help | How to fix duplicate user accounts in your Squabbit golf tournament, league, or club. |
| howToLoginOnWebAfterSigningUpUsingAppleOnIosArticle.html | Login on Web After Apple Sign-In - Squabbit Help | How to log into Squabbit on the web after signing up with Apple on iOS. |
| howHandicapsWork.html | How Handicaps Work in Squabbit | Learn how golf handicaps are calculated in Squabbit including Handicap Index, Course Handicap, and Playing Handicap. |
| alternateShotGameArticle.html | Alternate Shot Golf Game - Squabbit Help | Learn how to play and set up Alternate Shot (Foursomes) golf games in Squabbit. |
| pressesArticle.html | Presses in Golf Games - Squabbit Help | Learn how golf presses work and how to set them up in Squabbit for Nassau and other betting games. |
| tournamentV8Migration.html | Tournament Format Updates - Squabbit Help | Information about Squabbit's tournament format system updates and what changed. |

- [ ] **Step 3: Commit**

---

### Task 5: Add meta tags to remaining pages

**Files:**
- Modify: `supportSquabbit.html`, `tournament.html`, `league.html`

- [ ] **Step 1: Add meta tags to supportSquabbit.html**

Description: "Support Squabbit's development. Squabbit is free golf tournament and league software — chip in to help keep it that way."
Title: "Support Squabbit - Help Keep Golf Tournament Software Free"

- [ ] **Step 2: Add meta tags to tournament.html and league.html**

These are dynamic leaderboard pages, so just add basic meta tags. These aren't primary SEO targets but should have proper canonical URLs and basic descriptions.

- [ ] **Step 3: Commit**

---

### Task 6: Expand sitemap.xml

**Files:**
- Modify: `sitemap.xml`

- [ ] **Step 1: Add missing URLs to sitemap**

Add the following missing URLs:
- `https://www.squabbitgolf.com/supportSquabbit.html` (already present, verify)
- `https://www.squabbitgolf.com/tournament.html` (priority 0.4)
- `https://www.squabbitgolf.com/league.html` (priority 0.4)
- All help articles not currently in the sitemap:
  - `addingATeamFormat/addingATeamTournamentFormat.html` (0.6)
  - `addingABlind/addingABlind.html` (0.6)
  - `club/articles/creatingAClubArticle.html` (0.6)
  - `gettingStarted/articles/whenToChooseGroupType.html` (0.6)
  - `gettingStarted/articles/registeringForAGroup/registeringForAGroup.html` (0.6)
  - `account/articles/fixingDuplicateUsersArticle.html` (0.6)
  - `account/articles/howToLoginOnWebAfterSigningUpUsingAppleOnIosArticle.html` (0.5)
  - `gamesAndFormats/articles/alternateShotGameArticle.html` (0.6)
  - `gamesAndFormats/articles/pressesArticle.html` (0.6)
  - `handicaps/articles/howHandicapsWork/howHandicapsWork.html` (already present, verify)
  - `migrations/tournamentV8Migration.html` (0.4)

- [ ] **Step 2: Commit**

---

### Task 7: Run build script and final verification

- [ ] **Step 1: Run `node build.js`**

Verify all pages have:
- Inline nav and footer HTML (view source)
- No remaining `fetch('/header.html')` calls
- Proper meta descriptions in `<head>`
- BlogPosting JSON-LD on all blog entries
- Only one H1 on help.html

- [ ] **Step 2: Final commit of built output**
