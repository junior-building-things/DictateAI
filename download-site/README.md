# DictateAI Download Site

This folder is a standalone static download page for the macOS desktop app.

## What it ships

- `index.html`: landing page
- `styles.css`: static styling
- `assets/icon.png`: icon used on the page
- `downloads/DictateAI-latest-aarch64.dmg`: the public download artifact

## Update the downloadable app

1. Build a new macOS release locally:

```bash
cd /Users/bytedance/Documents/Personal/Coding/dictate-ai
env CARGO_TARGET_DIR=/tmp/dictateai-target npm run tauri build
```

2. Replace the hosted DMG with the new build:

```bash
cp /Users/bytedance/Documents/Personal/Coding/dictate-ai/src-tauri/target/release/bundle/dmg/DictateAI_<version>_aarch64.dmg \
  /Users/bytedance/Documents/Personal/Coding/dictate-ai/download-site/downloads/DictateAI-latest-aarch64.dmg
```

3. Update the visible version label in `index.html` if needed.

4. Commit and push. Render will redeploy the static site from this folder.

## Why the DMG is committed

Render cannot build a macOS DMG on its Linux static-site builders, so the downloadable artifact must already exist in the repository (or be fetched from another host). For now, this site serves the prebuilt DMG directly from source control.
