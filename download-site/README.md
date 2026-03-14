# DictateAI Download Site

This folder is a standalone static download page for the DictateAI macOS desktop app.
It is now set up for Vercel and currently supports Apple Silicon only.

## What it ships

- `index.html`: landing page
- `styles.css`: static styling
- `vercel.json`: Vercel routing and cache headers
- `assets/icon.png`: icon used on the page
- `downloads/DictateAI-latest-aarch64.dmg`: the public download artifact

## Update the downloadable app

1. Build a new Apple Silicon release locally:

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

4. Commit and push.

## Deploy on Vercel

1. Import the GitHub repo into Vercel.
2. Set the project Root Directory to `download-site`.
3. Leave the framework preset as `Other`.
4. No build command is required.
5. Deploy.

`vercel.json` handles:
- `/download` redirecting to the latest Apple Silicon DMG
- short cache for the page
- longer cache for files under `/downloads`

## Why the DMG is committed

Vercel cannot build a macOS DMG on its Linux builders, so the downloadable artifact must already exist in the repository (or be fetched from another host). For now, this site serves the prebuilt DMG directly from source control.
