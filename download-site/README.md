# DictateAI Download Site

This folder is a standalone static download page for the macOS desktop app.

## What it ships

- `index.html`: landing page
- `styles.css`: static styling
- `assets/icon.png`: icon used on the page
- `downloads/DictateAI-latest-aarch64.dmg`: the public download artifact
- `downloads/DictateAI-latest-x64.dmg`: the Intel macOS download artifact

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

3. Build a new Intel release locally:

```bash
rustup target add x86_64-apple-darwin
```

The current Intel build is intentionally API-only. The bundled on-device runtime is disabled on non-Apple-Silicon builds, so an x86_64 `llama-cli` sidecar is not required for this release path.

Then build:

```bash
cd /Users/bytedance/Documents/Personal/Coding/dictate-ai
env CARGO_TARGET_DIR=/tmp/dictateai-target npm run tauri build -- --target x86_64-apple-darwin
```

And copy the Intel DMG into the public download slot:

```bash
cp /tmp/dictateai-target/x86_64-apple-darwin/release/bundle/dmg/DictateAI_<version>_x64.dmg \
  /Users/bytedance/Documents/Personal/Coding/dictate-ai/download-site/downloads/DictateAI-latest-x64.dmg
```

4. Update the visible version label in `index.html` if needed.

5. Commit and push. Render will redeploy the static site from this folder.

## Why the DMG is committed

Render cannot build a macOS DMG on its Linux static-site builders, so the downloadable artifact must already exist in the repository (or be fetched from another host). For now, this site serves the prebuilt DMG directly from source control.
