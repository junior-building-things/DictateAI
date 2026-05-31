# CLAUDE.md — DictateAI (Tauri Desktop App)

## Project Overview

A macOS desktop app for **push-to-talk dictation**. Hold a global hotkey to record your microphone, release to transcribe with the configured speech provider, optionally rewrite/clean up the text with an LLM, then auto-paste the result into the active app. Every result is also copied to the clipboard and saved to local SQLite history.

**The flow:**
1. User holds the global hotkey (default `CommandOrControl+Shift+Space`) — a rolling pre-roll buffer means the start of speech isn't clipped.
2. Audio is captured; on release it's sent to the selected speech-to-text engine (cloud API or on-device).
3. The raw transcript is optionally rewritten by an LLM using configurable cleanup rules, a vocabulary list, and phrase mappings.
4. The final text is auto-pasted into the foreground app (simulated `Cmd+V`, requires Accessibility permission), copied to the clipboard, and stored in history.
5. Partial transcripts stream into an overlay during recording for live feedback.

## Core Product Principles

- **Latency is the product.** This is a typing replacement — the round trip from hotkey-release to pasted text must feel instant. Engines are pre-warmed at startup and after install. Cloud calls have tight timeouts (speech ~8s, rewrite ~10s).
- **On-device first where it's good enough.** Local Parakeet STT (via sherpa-onnx, Metal-accelerated) and Apple Foundation Models / llama.cpp rewrite let the app run offline with zero per-use cost. The defaults lean local (speech: NVIDIA/Parakeet on-device; rewrite: Groq).
- **Don't mangle the user's words.** Rewrite is *cleanup*, not paraphrase. Small LLMs are explicitly steered away from wrapping output in quotes or editorializing. Vocabulary terms and phrase mappings exist to keep names/jargon correct.
- **Stay out of the way.** Runs from the tray/menu bar. The main window is settings + history; daily use is just the hotkey and the overlay.
- **Provider-agnostic.** Speech and rewrite are independent, swappable providers. Adding a provider should be a localized change, not a rewrite.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4, React Router v7, `motion`, `lucide-react`, `sonner`
- **Desktop runtime:** Tauri v2 (`@tauri-apps/api`, plugins: `global-shortcut`, `clipboard-manager`, `process`, `updater`)
- **Backend:** Rust
- **Database:** SQLite via `rusqlite` (`dictate-ai.db` in the app data dir)
- **Local STT:** NVIDIA Parakeet TDT 0.6B (v2 / v3, int8) via statically-linked **sherpa-onnx**, Metal on Apple Silicon
- **Local LLM rewrite:** llama.cpp (Metal) and Apple **Foundation Models** (macOS, on-device)
- **Updates:** Tauri updater reading GitHub Releases `latest.json`

## Providers

**Speech-to-text** (`src-tauri/src/transcribe/`):
- Cloud (`api.rs`): Deepgram `nova-3`, OpenAI `gpt-4o-transcribe` / `gpt-4o-mini-transcribe`, Google `chirp_3`, NVIDIA (API), Alibaba `qwen3-asr-flash`, Doubao/BytePlus.
- Local (`local/parakeet.rs`): `parakeet-tdt-0.6b-v2-int8`, `parakeet-tdt-0.6b-v3-int8` (downloaded on demand, run offline).

**Rewrite** (`src-tauri/src/rewrite/`):
- Alibaba `qwen2.5-7b-instruct`, Apple Foundation Models (`apple-fm-system`, on-device macOS), Google Gemini `gemini-2.5-flash-lite` / `gemini-3.1-flash-lite-preview`, Groq `llama-3.1-8b-instant` / `llama-3.3-70b-versatile`, OpenAI `gpt-5-mini` / `gpt-5-nano`, plus local llama.cpp paths.

The canonical model catalog (labels, settings keys, latency/accuracy/cost metrics, default providers, and legacy-id migration aliases) lives in [src/lib/modelCatalog.ts](src/lib/modelCatalog.ts). It must stay in sync with the Rust-side `LocalModelSpec` IDs and the provider match arms in `transcribe/api.rs`, `processing_mode.rs`, and `rewrite/mod.rs`.

## Key Architecture Decisions

- **The pipeline is the spine.** [src-tauri/src/pipeline.rs](src-tauri/src/pipeline.rs) (`run`/`run_inner`) orchestrates the whole flow: state transitions, transcribe → rewrite → deliver (paste + clipboard + history), event emission to the UI, and the placeholder/overlay lifecycle. A monotonic `run_id` guards against stale runs owning state cleanup when a new recording starts mid-processing.
- **Hotkey handling is in the Tauri shortcut callback.** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) wires `global-shortcut`; `hotkey_mode` (`hold` vs toggle) decides press/release semantics. `hotkey/handler.rs` owns press/release. Manual recording start/stop commands also exist for non-hotkey triggers.
- **Audio capture keeps a rolling pre-roll buffer** (`audio/capture.rs`) so the moment before the hotkey registers isn't lost.
- **Provider readiness is resolved centrally.** `processing_mode.rs::resolve` checks the selected `speech_model` against whichever API keys / downloaded local models are present, so the UI and pipeline agree on whether a config is usable.
- **Settings are key/value rows in SQLite**, not a typed struct. Read/written via `db/settings.rs` and the `get_setting`/`save_setting`/`get_settings` Tauri commands. Treat setting keys as a loose contract shared between Rust and the frontend.
- **Frontend ↔ backend is Tauri commands + events.** Commands are registered in `lib.rs`'s `invoke_handler!` and called from [src/lib/commands.ts](src/lib/commands.ts). The backend emits events (e.g. `state-changed`, partial transcripts) the UI listens for; `src/lib/useDictation.ts` and `src/lib/store.tsx` hold the React-side state.
- **Two windows.** The settings/history window (routed React app under `src/app/`) and a lightweight always-on overlay (`src/Overlay.tsx` + `overlay.rs`) shown during recording. A tray menu (`tray.rs`) provides quick access.

## Source Layout

**Frontend (`src/`):**
- [src/app/routes.ts](src/app/routes.ts) — React Router config. Routes: `/` (Dashboard), `/history`, `/vocabulary`, `/settings`, all under `Layout`.
- [src/app/pages/](src/app/pages/) — current routed pages (the redesigned UI): `Dashboard`, `History`, `Vocabulary`, `Settings`, plus `Hotkey`, `RewriteRules`, `Languages`, `Models`, `Home`.
- [src/app/components/Layout.tsx](src/app/components/Layout.tsx) — sidebar + page shell for the redesigned desktop UI.
- [src/components/](src/components/) — feature components (settings panels, history viewer, vocabulary manager, model cards, hotkey/prompt/api-key settings, etc.).
- [src/lib/](src/lib/) — `commands.ts` (Tauri command wrappers), `useDictation.ts`, `store.tsx`, `modelCatalog.ts`, `hotkeys.ts`, `i18n.tsx`, `types.ts`, `utils.ts`.
- [src/Overlay.tsx](src/Overlay.tsx) — the recording overlay window root.
- [src/styles/](src/styles/) — Tailwind v4 + theme/font CSS.

**Backend (`src-tauri/src/`):**
- `lib.rs` / `main.rs` — app setup, plugin + shortcut wiring, `invoke_handler!` command registration.
- `pipeline.rs` — end-to-end dictation orchestration.
- `commands.rs` — all `#[tauri::command]` functions (settings, history, vocabulary, models, API-key validation, recording control, permission checks).
- `audio/` — `capture.rs` (mic + pre-roll buffer), `feedback.rs` (sounds), `mod.rs`.
- `transcribe/` — `api.rs` (cloud STT), `local/` (Parakeet via sherpa-onnx + model download), `model_manager.rs`.
- `rewrite/` — one file per provider (`gemini`, `openai`, `groq`, `alibaba`, `apple_fm`, `local_llm`, `local_cleanup`) + `prompt.rs` + `mod.rs`.
- `db/` — `schema.rs`, `settings.rs`, `history.rs`, `vocabulary.rs`.
- `hotkey/`, `paste/` (simulated `Cmd+V`), `overlay.rs`, `tray.rs`, `state.rs`, `processing_mode.rs`, `error.rs`.

## Build & Run

```bash
npm install
npm run tauri dev      # run the app in development
npm run tauri build    # build the desktop bundle + DMG
npm run lint           # eslint
npm run build          # tsc -b && vite build (frontend only)
```

Prerequisites: Node + npm, Rust toolchain, Tauri OS prerequisites, and `cmake` (for the bundled llama.cpp build — `brew install cmake` on macOS).

## Permissions (macOS)

- **Microphone** — recording.
- **Accessibility** — simulating `Cmd+V` for auto-paste.

Helper: `./grant_permissions.sh`. Permission state is checked from the app via `check_microphone_permission` / `check_accessibility` commands.

## Data Stored Locally

App data directory holds `dictate-ai.db` (SQLite) with tables: `settings`, `vocabulary`, `transcription_history`. Notable setting keys: `hotkey`, `hotkey_mode`, `speech_model`, per-provider API keys (`speech_*_api_key`, `gemini_api_key`, etc.), `language`, `auto_paste`, `sound_enabled`, `max_recording_seconds`, `max_history_context`.

## Releases & Updates

DictateAI uses Tauri's updater. Installed apps check GitHub Releases (`junior-building-things/DictateAI`) `latest.json` on launch, download in the background, and apply on next open. Initial install is from the website DMG.

**To publish an update:**
1. Bump the version in **all four**: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/i18n.tsx`.
2. Commit and push.
3. Create and push a git tag like `v1.0.12`.
4. `.github/workflows/release.yml` builds the macOS bundle + DMG, packages and signs `DictateAI.app.tar.gz` with `tauri signer`, and uploads `latest.json`.

The updater private key is in GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` (the public key is embedded in the app).

---

## How Claude Should Work on This Codebase

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Commits, Pushes, and Releases
This is an installed desktop app, not an auto-deployed web app — **do not commit or push unless the user asks.** Work on the current branch; don't switch or rename branches without being told.

When you do ship a version, follow the release checklist above: bump the version in all four files, then tag `vX.Y.Z` to trigger the GitHub Actions release. Never push a tag without the user's go-ahead — it publishes an update to every installed app.
