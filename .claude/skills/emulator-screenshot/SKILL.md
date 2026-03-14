---
name: emulator-screenshot
description: Take a screenshot from a connected Android emulator, resize it, and convert to WebP for use in help articles or web pages. Use when the user asks to capture, screenshot, or snap the emulator screen.
argument-hint: "[optional: output path and/or width, e.g. 'assets/help/login.webp 400']"
allowed-tools: Bash
user-invocable: true
---

Take a screenshot from the connected Android emulator and convert it to a small WebP file suitable for web use.

## Important rules

- **Never re-encode a WebP file.** Always convert from the original PNG source. Re-encoding WebP degrades quality.
- **Never resize, re-encode, or overwrite an existing WebP image without confirming with the user first.** Temp PNGs can be deleted freely.
- **Always convert from the highest resolution source available** (the raw PNG or annotated PNG), never from an already-compressed file.

## Steps

### 1. Parse arguments
From `$ARGUMENTS`, extract:
- **output_path**: Where to save the WebP file. Default: `./screenshot.webp`
- **display_width**: The CSS display width used in HTML `width` attributes. Default: `360`
- **export_width**: The actual image pixel width, 2x the display width for Retina/HiDPI sharpness. Default: `720`
- **quality**: WebP quality (1-100). Default: `75`

Examples:
- `/emulator-screenshot` → `./screenshot.webp` at 720px export (360px display), quality 75
- `/emulator-screenshot assets/help/login.webp` → `assets/help/login.webp` at 720px export (360px display)
- `/emulator-screenshot assets/help/login.webp 500` → 1000px export (500px display)
- `/emulator-screenshot 400` → `./screenshot.webp` at 800px export (400px display)

### 2. Identify the emulator
Run `adb devices` to list connected devices. If multiple devices are connected, ask the user which one to use. Look for emulator entries (e.g., `emulator-5554`).

### 3. Capture the screenshot
```bash
adb [-s <device>] exec-out screencap -p > /tmp/emulator_screenshot_raw.png
```

### 4. Crop (if requested)
If the user asks to crop the image, use ImageMagick (`magick`). If not installed, install with `brew install imagemagick`.

The emulator screenshot is typically 1080x2400. Cropping examples:

**Cut off bottom portion** (e.g. bottom 1/3 = keep top 1600px, bottom 1/5 = keep top 1920px):
```bash
magick /tmp/emulator_screenshot_raw.png -crop 1080x<keep_height>+0+0 +repage /tmp/emulator_cropped.png
```

**Cut off top portion** (e.g. top 1/3 = keep bottom 1600px starting at y=800):
```bash
magick /tmp/emulator_screenshot_raw.png -crop 1080x<keep_height>+0+<y_offset> +repage /tmp/emulator_cropped.png
```

**Remove middle section** (stitch top and bottom together):
```bash
magick /tmp/emulator_screenshot_raw.png -crop 1080x800+0+0 +repage /tmp/top.png
magick /tmp/emulator_screenshot_raw.png -crop 1080x800+0+1600 +repage /tmp/bottom.png
magick /tmp/top.png /tmp/bottom.png -append /tmp/emulator_cropped.png
rm /tmp/top.png /tmp/bottom.png
```

**Important:** Do NOT use `sips -c` for cropping — it crops from the center, not from the edges, and will cut off the top of the image.

If cropping was applied, use `/tmp/emulator_cropped.png` as input for the next step instead of the raw screenshot.

### 5. Annotation (optional)
By default, skip annotation and go straight to conversion. If the user says "ready make edits" (or similar), save the screenshot as a PNG next to the output path, open it, and **stop and wait** for the user to say "done" before converting.

```bash
cp <input_file> <output_path_but_with_.png_extension>
open <png_path>
```

If the user just says "ready" (no mention of edits), skip this step entirely and convert directly from the raw screenshot.

When opening a PNG for annotation, also tell the user what the **next** screenshot will be so they can navigate the emulator while editing.

### 6. Convert to WebP
Use `cwebp` to resize and convert **from the original PNG** (raw, cropped, or annotated — never from an existing WebP). If `cwebp` is not installed, install it with `brew install webp`.

```bash
cwebp -q <quality> -resize <export_width> 0 <input_file> -o <output_path>
```

The `-resize <width> 0` flag maintains aspect ratio. The export width is 2x the display width (e.g., 720px export for 360px display).

### 7. Report dimensions
After conversion, read the final image dimensions using `sips` and report them to the user. These are needed for correctly proportioned HTML `<img>` and container `<span>` styles in help articles.

```bash
sips -g pixelWidth -g pixelHeight <output_path>
```

Report both the export and display dimensions like: "Output image: **720 x 800** px (displays at 360 x 400)"

### 8. Clean up
Remove temp PNG and raw screenshot files:
```bash
rm <png_path> /tmp/emulator_screenshot_raw.png /tmp/emulator_cropped.png
```

### 9. What's next
After completing a screenshot, if there are more images to capture (e.g. replacing TODO placeholders in an article), ask the user if they're ready for the next one. Tell the user what screen to navigate to for the next screenshot.

Only crop when explicitly asked — do not crop by default.
