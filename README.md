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
