---
name: emulator-screenshot
description: Take a screenshot from a connected Android emulator, resize it, and convert to WebP for use in help articles or web pages. Use when the user asks to capture, screenshot, or snap the emulator screen.
argument-hint: "[optional: output path and/or width, e.g. 'assets/help/login.webp 400']"
allowed-tools: Bash
user-invocable: true
---

Take a screenshot from the connected Android emulator and convert it to a small WebP file suitable for web use.

## Steps

### 1. Parse arguments
From `$ARGUMENTS`, extract:
- **output_path**: Where to save the WebP file. Default: `./screenshot.webp`
- **width**: Resize width in pixels. Default: `360`
- **quality**: WebP quality (1-100). Default: `75`

Examples:
- `/emulator-screenshot` → `./screenshot.webp` at 360px wide, quality 75
- `/emulator-screenshot assets/help/login.webp` → `assets/help/login.webp` at 360px wide
- `/emulator-screenshot assets/help/login.webp 500` → 500px wide
- `/emulator-screenshot 400` → `./screenshot.webp` at 400px wide

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

### 5. Convert to WebP
Use `cwebp` to resize and convert. If `cwebp` is not installed, install it with `brew install webp`.

```bash
cwebp -q <quality> -resize <width> 0 <input_file> -o <output_path>
```

The `-resize <width> 0` flag maintains aspect ratio.

### 6. Preview and clean up
Open the file for preview and remove temp files:
```bash
open <output_path>
rm /tmp/emulator_screenshot_raw.png /tmp/emulator_cropped.png
```

### 7. What's next
After completing a screenshot, if there are more images to capture (e.g. replacing TODO placeholders in an article), ask the user if they're ready for the next one. Assume the user has already navigated the emulator to the correct screen when they say "next".

Only crop when explicitly asked — do not crop by default.
