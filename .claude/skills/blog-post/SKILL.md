---
name: blog-post
description: Create a new blog post for the Squabbit website. Use when the user asks to write, add, or create a blog post or blog entry.
argument-hint: "[topic or feature name]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
user-invocable: true
---

Create a new blog post about: $ARGUMENTS

## Structure

Blog posts live in `blog/entries/<postName>/` with an HTML file and associated images.

### 1. Read an existing post for reference
Read `blog/entries/publicLeaderboards/publicLeaderboards.html` to match the current style and HTML template.

### 2. Create the post directory and HTML file

**Directory:** `blog/entries/<postName>/`
**File:** `blog/entries/<postName>/<postName>.html`

Template structure:
- Standard head with Bootstrap 5 CDN and `/css/article.css`
- `#header-placeholder` div
- `.container.mt-5.pt-5` > `.content-container` wrapper
- Centered `<h1>` title
- Body content using `<p class="c2">` for paragraphs and `<p class="c1">` for spacing
- Images centered with `<p class="text-center">` and inline `<span>` wrapper
- `#footer-placeholder` div
- Bootstrap JS bundle and fetch scripts for header/footer

**Image sizing:** Display phone screenshots at approximately 230x516px. Adjust proportionally if the source image has a different aspect ratio.

### 3. Add screenshots

Leave `<!-- TODO: description -->` comments with placeholder image references (`PLACEHOLDER_name.webp`) where screenshots are needed. Then use the `/emulator-screenshot` skill to capture each one:
1. Tell the user which screen to navigate to
2. Wait for them to confirm ready
3. Run `/emulator-screenshot blog/entries/<postName>/<imageName>.webp`
4. Update the HTML to replace the placeholder with the actual filename
5. Repeat for each screenshot

### 4. Add to blog index

Edit `blog.html` to add a new entry card **at the top** (newest first):

```html
<a href="/blog/entries/<postName>/<postName>.html" class="blog-entry-link">
    <div class="blog-entry">
        <img src="/blog/entries/<postName>/thumb.webp" alt="Blog Image" class="blog-image">
        <div class="blog-content">
            <h2 class="blog-title">Post Title</h2>
            <p class="blog-date">Mon DD, YYYY</p>
            <p class="blog-blurb">Short one-line description</p>
        </div>
    </div>
</a>
```

### 5. Create thumbnail

Create a smaller version of one of the screenshots for the blog index card:
```bash
magick blog/entries/<postName>/<image>.webp -resize 320x blog/entries/<postName>/thumb.webp
```

The blog card displays thumbnails at 160x160px with `object-fit: cover`.
