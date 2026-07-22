---
name: screenshots
description: Use when turning a screenshot the user pastes into a resized WebP for a help article, blog post, or web page, or when replacing a "SCREENSHOT NEEDED" / "IMAGE NEEDED" placeholder, or when the user asks to add, insert, convert, crop, or size a screenshot image. The user always pastes the source image (no emulator capture).
argument-hint: "[optional: output path and/or display width, e.g. 'blog/entries/foo/images/hero.webp 400']"
allowed-tools: Bash
user-invocable: true
---

Convert a screenshot the user has pasted into a small WebP file suitable for web use (help articles, blog posts, web pages).

**The user always provides the image by pasting it into the conversation. This skill never captures from an emulator or device.**

## Important rules

- **The source is the pasted image.** When the user pastes a screenshot, the harness saves it to a file and gives you the path (in the claude-deck app, under `.claude-deck/images/<timestamp>.png`). Use that pasted PNG as the source. If more than one image was pasted and it's ambiguous, ask which one; otherwise use the most recently pasted image.
- **Never re-encode a WebP file.** Always convert from the original pasted PNG. Re-encoding WebP degrades quality.
- **Always convert from the highest-resolution source available** (the raw pasted PNG, or a cropped/annotated PNG derived from it), never from an already-compressed file.
- **Never resize, re-encode, or overwrite an existing WebP image without confirming with the user first.** Temp PNGs can be deleted freely.

## Steps

### 1. Parse arguments
From `$ARGUMENTS`, extract:
- **output_path**: Where to save the WebP file. Default: `./screenshot.webp`
- **display_width**: The CSS display width used in HTML `width`/`max-width`. Default: `360`
- **export_width**: The actual image pixel width, 2x the display width for Retina/HiDPI sharpness. Default: `720`
- **quality**: WebP quality (1-100). Default: `75`

Examples:
- `/screenshots` → `./screenshot.webp` at 720px export (360px display), quality 75
- `/screenshots help/groups/tournament/articles/foo/images/wizard.webp` → that path at 720px export (360px display)
- `/screenshots blog/entries/foo/images/hero.webp 500` → 1000px export (500px display)
- `/screenshots 400` → `./screenshot.webp` at 800px export (400px display)

### 2. Identify the pasted source image
Use the path of the image the user just pasted (e.g. `.claude-deck/images/<timestamp>.png`). Confirm the file exists. Do NOT run `adb`, `screencap`, or any capture command; there is no emulator step.

### 3. Crop (if requested)
Only crop when explicitly asked. Use ImageMagick (`magick`). If not installed, install with `brew install imagemagick`.

A phone screenshot is typically 1080 wide. Cropping examples:

**Cut off bottom portion** (keep top `<keep_height>`px):
```bash
magick <pasted_png> -crop 1080x<keep_height>+0+0 +repage /tmp/screenshot_cropped.png
```

**Cut off top portion** (keep bottom, starting at y=`<y_offset>`):
```bash
magick <pasted_png> -crop 1080x<keep_height>+0+<y_offset> +repage /tmp/screenshot_cropped.png
```

**Remove middle section** (stitch top and bottom together):
```bash
magick <pasted_png> -crop 1080x800+0+0 +repage /tmp/top.png
magick <pasted_png> -crop 1080x800+0+1600 +repage /tmp/bottom.png
magick /tmp/top.png /tmp/bottom.png -append /tmp/screenshot_cropped.png
rm /tmp/top.png /tmp/bottom.png
```

**Important:** Do NOT use `sips -c` for cropping — it crops from the center, not from the edges, and will cut off the top of the image. Use the pasted image's real dimensions (`sips -g pixelWidth -g pixelHeight <pasted_png>`) if it isn't 1080 wide.

If cropping was applied, use `/tmp/screenshot_cropped.png` as input for the next step instead of the raw pasted PNG.

### 4. Annotation (optional)
By default, skip annotation and go straight to conversion. If the user says "ready make edits" (or similar), save the screenshot as a PNG next to the output path, open it, and **stop and wait** for the user to say "done" before converting.

```bash
cp <input_file> <output_path_but_with_.png_extension>
open <png_path>
```

If the user just says "ready" (no mention of edits), skip this step entirely and convert directly from the pasted PNG.

### 5. Convert to WebP
Use `cwebp` to resize and convert **from the original PNG** (raw pasted, cropped, or annotated — never from an existing WebP). If `cwebp` is not installed, install it with `brew install webp`. Create the output directory if needed (`mkdir -p`).

```bash
cwebp -q <quality> -resize <export_width> 0 <input_file> -o <output_path>
```

The `-resize <width> 0` flag maintains aspect ratio. The export width is 2x the display width (e.g., 720px export for 360px display).

### 6. Report dimensions
After conversion, read the final image dimensions and report them. These are needed for correctly proportioned HTML `<img>` and container styles.

```bash
sips -g pixelWidth -g pixelHeight <output_path>
```

Report both export and display dimensions like: "Output image: **720 x 800** px (displays at 360 x 400)"

### 7. Insert into HTML

**ALWAYS cap the display width with an inline `max-width` (in px).** App screenshots are ~1000px+ wide; without a cap they blow up to full container width (huge, upscaled, overflowing the card). The intrinsic pixel size is 2x for retina, NOT the display size, so the browser will show the image at its natural width unless you cap it. Set `max-width` to the display width you want (typically 320-480px for phone/app shots), never leave it uncapped.

The two surfaces use DIFFERENT markup. Match the surface you're editing (open a sibling file to confirm):

**Help articles** use a styled `<img>` directly:
```html
<img class="article-img" src="images/foo.webp" alt="..." style="max-width: 420px;">
```
`.article-img` in the article's CSS already does `max-width:100%; display:block; margin:20px auto` (centered), so your inline `max-width` just caps it.

**Blog entries** use a `.fig` WRAPPER, not a class on the `<img>`. The CSS targets `.fig img` (an img INSIDE a `.fig` element), so `<img class="fig">` matches NO rule and renders at full natural size. Wrap it and cap the width:
```html
<div class="fig"><img src="foo.webp" alt="..." style="max-width: 420px; width: 100%;"></div>
```
The `.fig` wrapper centers the image and adds the rounded corners/shadow; `width: 100%` keeps it responsive up to the `max-width` cap. (Blog images live in the entry root, e.g. `src="foo.webp"`, not an `images/` subfolder.)

**Tall (portrait) screenshots:** for anything taller than ~1.4x its display width, constrain by height instead so it doesn't dominate the page: use `max-height: 520px; width: auto;` (help articles) or inside the `.fig` wrapper `style="max-height: 520px; width: auto;"` (blogs). For landscape or roughly square shots, `max-width` alone is right.

When replacing a `<!-- SCREENSHOT NEEDED: ... -->` / `<!-- IMAGE NEEDED: ... -->` placeholder, swap the comment for the real image markup. For blog hero/thumbnail slots, also wire the `og:image`/`twitter:image`/JSON-LD image to the entry's `thumb.webp`.

**Verify after inserting:** render or eyeball the page. A phone screenshot that spans the full content column or overflows the card is the uncapped/wrong-wrapper bug above.

### 8. Clean up
Remove temp working PNGs (leave the user's pasted original alone; the harness manages it):
```bash
rm -f /tmp/screenshot_cropped.png
```
Also remove any annotation PNG you created next to the output path once converted, unless the user wants to keep it.

### 9. What's next
After completing a screenshot, if there are more images to place (e.g. remaining `SCREENSHOT NEEDED` / `IMAGE NEEDED` placeholders), tell the user which screen/placeholder is next and ask them to paste it.
