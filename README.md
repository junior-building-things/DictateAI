# DictateAI (Tauri)

Desktop app for push-to-talk transcription with optional Gemini cleanup and auto-paste.

## What it does

- Hold a global hotkey to record microphone audio.
- Release to transcribe with the configured speech API provider.
- Optionally rewrite text with Gemini using strict cleanup rules.
- Save raw and rewritten text to SQLite history.
- Copy to clipboard and auto-paste into the active app (when accessibility permission is granted).

## Tech stack

- Frontend: React + TypeScript + Vite + Tailwind
- Desktop runtime: Tauri v2
- Backend: Rust
- DB: SQLite (`rusqlite`)

## Prerequisites

- Node.js + npm
- Rust toolchain
- Tauri prerequisites for your OS
- macOS users: microphone + accessibility permissions are required for full behavior

## Development

Install dependencies:

```bash
npm install
```

Run app in development:

```bash
npm run tauri dev
```

Build desktop app:

```bash
npm run tauri build
```

## In-app updates

DictateAI now uses Tauri's updater flow for installed desktop apps.

- The app checks GitHub Releases at:
  - `https://github.com/junior-building-things/DictateAI/releases/latest/download/latest.json`
- Initial install still comes from the website DMG.
- Installed apps update from signed updater bundles, not from the DMG.

### One-time setup

1. A Tauri updater public key is embedded in the app.
2. Add the private key to GitHub Actions secrets:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < /Users/thomas/.tauri/dictateai-updater.key
```

3. If you generated a password-protected key, also add:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

### Publish a new app update

1. Bump the app version in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src/lib/i18n.tsx`
2. Commit and push.
3. Create and push a git tag like `v1.0.6`.
4. GitHub Actions runs `.github/workflows/release.yml` and publishes:
   - the macOS app bundle + DMG
   - signed updater artifacts
   - `latest.json`

The release workflow now builds the normal macOS app with `tauri build`, then packages `DictateAI.app.tar.gz`, signs it with `tauri signer`, and uploads the generated `latest.json` to GitHub Releases.

After that, installed DictateAI apps check for updates automatically on launch, download them in the background, and apply them the next time the app is opened.

## First-time setup in app

1. Open the app settings window.
2. In `Models`, add the API keys required for your selected speech and rewrite providers.
3. Use and hold hotkey (default: `CommandOrControl+Shift+Space`) to record.

## Permissions (macOS)

- Microphone permission for recording.
- Accessibility permission for simulating `Cmd+V` auto-paste.

Helper script:

```bash
./grant_permissions.sh
```

## Data stored locally

App data directory contains:

- `dictate-ai.db` SQLite database:
  - `settings`
  - `vocabulary`
  - `transcription_history`

## Key settings

- `hotkey`
- `language`
- `gemini_api_key`
- `auto_paste`
- `sound_enabled`
- `max_recording_seconds`
- `max_history_context`
