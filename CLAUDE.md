# CLAUDE.md — DictateAI (Tauri Desktop App)

## Project Overview

A macOS desktop app for **push-to-talk dictation**. Hold a global hotkey to record your microphone, release to transcribe with the configured speech provider, optionally rewrite/clean up the text with an LLM, then auto-paste the result into the active app (or copy it to the clipboard when auto-paste is off, or when typing fails). Every result is saved to local SQLite history.

**The flow:**
1. User holds the global hotkey (default Right Option, a modifier-only binding handled by `hotkey/right_option.rs`) — a rolling pre-roll buffer is meant to keep the start of speech, but it is empty while `IDLE_STREAM_TIMEOUT` is zero (see `audio/capture.rs`).
2. Audio is captured; on release it's sent to the selected speech-to-text engine (cloud API or on-device).
3. The raw transcript is optionally rewritten by an LLM using configurable cleanup rules, a vocabulary list, and phrase mappings.
4. The final text is auto-pasted into the foreground app (simulated `Cmd+V`, requires Accessibility permission) — or, with auto-paste off or if typing fails, copied to the clipboard — and stored in history.
5. In toggle mode a "Listening…" placeholder is typed into the focused field and swapped for the result. Hold mode skips it — the OS hotkey grab swallows injected keystrokes while the key is down.

## Core Product Principles

- **Latency is the product.** This is a typing replacement — the round trip from hotkey-release to pasted text must feel instant. Engines are pre-warmed at startup and after install. Cloud calls time out at 15s for both speech and rewrite — note this is **not** enough for the 20-minute `max_recording_seconds` cap, see Known Gaps.
- **On-device first where it's good enough.** Local Parakeet STT (via sherpa-onnx, CPU) and Apple Foundation Models / llama.cpp rewrite let the app run offline with zero per-use cost. Local paths exist but the shipped defaults are cloud: speech `whisper-large-v3-turbo` on Groq, rewrite `gemini-3.5-flash-lite` on Google.
- **Don't mangle the user's words.** Rewrite is *cleanup*, not paraphrase. Small LLMs are explicitly steered away from wrapping output in quotes or editorializing. Vocabulary terms and phrase mappings exist to keep names/jargon correct.
- **Stay out of the way.** Runs from the tray/menu bar. The main window is settings + history; daily use is just the hotkey.
- **Provider-agnostic.** Speech and rewrite are independent, swappable providers. Adding a provider should be a localized change, not a rewrite.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4, React Router v7, `motion`, `lucide-react`, `sonner`
- **Desktop runtime:** Tauri v2 (`@tauri-apps/api`, plugins: `global-shortcut`, `clipboard-manager`, `process`, `updater`)
- **Backend:** Rust
- **Database:** SQLite via `rusqlite` (`dictate-ai.db` in the app data dir)
- **Local STT:** NVIDIA Parakeet TDT 0.6B (v2 / v3, int8) via statically-linked **sherpa-onnx**, on the CPU (no GPU provider in the static build)
- **Local LLM rewrite:** llama.cpp (Metal) and Apple **Foundation Models** (macOS, on-device)
- **Updates:** Tauri updater reading GitHub Releases `latest.json`

## Providers

**Speech-to-text** (`src-tauri/src/transcribe/`):
- Cloud (`api.rs`): Deepgram `nova-3`, OpenAI `gpt-transcribe`, Google `chirp_3`, NVIDIA (API), Alibaba `qwen3-asr-flash`, Doubao/BytePlus.
- Local (`local/parakeet.rs`): `parakeet-tdt-0.6b-v2-int8`, `parakeet-tdt-0.6b-v3-int8` (downloaded on demand, run offline).

**Rewrite** (`src-tauri/src/rewrite/`):
- Alibaba `qwen2.5-7b-instruct`, Apple Foundation Models (`apple-fm-system`, on-device macOS), Google Gemini `gemini-3.5-flash-lite` (default), `gemini-3.6-flash`, Groq `openai/gpt-oss-20b` / `openai/gpt-oss-120b` (low reasoning effort), OpenAI `gpt-6-luna` / `gpt-6.1-terra` (reasoning off), plus local llama.cpp paths.

The canonical model catalog (labels, settings keys, latency/accuracy/cost metrics, default providers, and legacy-id migration aliases) lives in [src/lib/modelCatalog.ts](src/lib/modelCatalog.ts). It must stay in sync with the Rust-side `LocalModelSpec` IDs and the provider match arms in `transcribe/api.rs`, `processing_mode.rs`, and `rewrite/mod.rs`.

## Key Architecture Decisions

- **The pipeline is the spine.** [src-tauri/src/pipeline.rs](src-tauri/src/pipeline.rs) (`run`/`run_inner`) orchestrates the whole flow: state transitions, transcribe → rewrite → deliver (paste + clipboard + history), event emission to the UI, and the placeholder lifecycle. A monotonic `run_id` guards against stale runs owning state cleanup when a new recording starts mid-processing.
- **Hotkey handling is in the Tauri shortcut callback.** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) wires `global-shortcut`; `hotkey_mode` (`hold` vs toggle) decides press/release semantics. `hotkey/handler.rs` owns press/release. Manual recording start/stop commands also exist for non-hotkey triggers.
- **Audio capture keeps a rolling pre-roll buffer** (`audio/capture.rs`) so the moment before the hotkey registers isn't lost.
- **Provider readiness is resolved centrally.** `processing_mode.rs::resolve` checks the selected `speech_model` against whichever API keys / downloaded local models are present, so the UI and pipeline agree on whether a config is usable.
- **Settings are key/value rows in SQLite**, not a typed struct. Read/written via `db/settings.rs` and the `get_setting`/`save_setting`/`get_settings` Tauri commands. Treat setting keys as a loose contract shared between Rust and the frontend.
- **Frontend ↔ backend is Tauri commands + events.** Commands are registered in `lib.rs`'s `invoke_handler!` and called from [src/lib/commands.ts](src/lib/commands.ts). The backend emits events (`state-changed`, `transcription-complete`, `pipeline-error`, `dictation-edited`) the UI listens for; `src/lib/useDictation.ts` and `src/lib/store.tsx` hold the React-side state.
- **One window.** The settings/history window (routed React app under `src/app/`), plus a tray menu (`tray.rs`). The old NSPanel overlay window was removed once nothing rendered in it; recover it from history if floating UI is ever wanted again.
- **Secrets live in the Keychain, not SQLite.** `db/settings.rs` routes the nine `SECRET_KEYS` (API keys and tokens) to the macOS Keychain, cached once per key per run. Everything else is a plain settings row.
- **The microphone is released between dictations.** `audio/capture.rs` drops the cpal stream when idle — holding it keeps a `PreventUserIdleSystemSleep` assertion up and stops the Mac sleeping.

## Source Layout

**Frontend (`src/`):**
- [src/app/routes.ts](src/app/routes.ts) — React Router config. Routes: `/` (Dashboard), `/history`, `/vocabulary`, `/settings`, all under `Layout`.
- [src/app/pages/](src/app/pages/) — current routed pages (the redesigned UI): `Dashboard`, `History`, `Vocabulary`, `Settings`, plus `Hotkey`, `RewriteRules`, `Languages`, `Models`, `Home`.
- [src/app/components/Layout.tsx](src/app/components/Layout.tsx) — sidebar + page shell for the redesigned desktop UI.
- [src/components/](src/components/) — `Dropdown`, `AppIcons`, `LocalModelCard` are live. **The other eleven files here are dead** — leftovers from the pre-redesign UI that nothing imports.
- [src/lib/](src/lib/) — `commands.ts` (Tauri command wrappers), `useDictation.ts`, `store.tsx`, `modelCatalog.ts`, `hotkeys.ts`, `i18n.tsx`, `types.ts`, `utils.ts`.
- [src/styles/](src/styles/) — Tailwind v4 + theme/font CSS.

**Backend (`src-tauri/src/`):**
- `lib.rs` / `main.rs` — app setup, plugin + shortcut wiring, `invoke_handler!` command registration.
- `pipeline.rs` — end-to-end dictation orchestration.
- `commands.rs` — all `#[tauri::command]` functions (settings, history, vocabulary, models, API-key validation, recording control, permission checks).
- `audio/` — `capture.rs` (mic + pre-roll buffer), `feedback.rs` (sounds), `mod.rs`.
- `transcribe/` — `api.rs` (cloud STT), `local/` (Parakeet via sherpa-onnx + model download), `model_manager.rs`.
- `rewrite/` — one file per provider (`gemini`, `openai`, `groq`, `alibaba`, `apple_fm`, `local_llm`, `local_cleanup`) + `prompt.rs` + `mod.rs`.
- `db/` — `schema.rs`, `settings.rs`, `history.rs`, `vocabulary.rs`.
- `hotkey/`, `paste/` (simulated `Cmd+V`), `tray.rs`, `state.rs`, `processing_mode.rs`, `error.rs`.

## Known Gaps

Real, unfixed, and worth knowing before touching the pipeline:

- **The 20-minute recording cap can't be delivered on cloud speech.** `max_recording_seconds` is 1200, but
  `API_SPEECH_TIMEOUT_SECONDS` is 15 and audio is uploaded whole as a 16 kHz 16-bit WAV — 20 minutes is
  38.4 MB. OpenAI and Groq reject anything over 25 MB (~13 min) and there is no size guard in
  `transcribe/api.rs`. Google `chirp_3` uses the synchronous `recognize` endpoint, capped near 60 s of audio.
  Only Deepgram and local Parakeet handle long recordings.
- **A rewrite *timeout* discards the transcript.** Each provider's `Ok(Err(_))` arm falls back to raw text,
  but the `Err(_)` timeout arm returns `Err` — so a successful transcription is thrown away rather than
  pasted. Four arms, same one-line fix.
- **`insert_text_slow`'s delay does nothing on macOS.** It sets `mac_delay: 100`, but enigo 0.2's
  `Keyboard::text()` goes through `fast_text()`, which posts 20-char `CGEvent` chunks and never reads
  `mac_delay`. Only `key()` honours it, so the Backspace path is genuinely fast and the "slow typing"
  reliability measure isn't in effect.
- **Placeholder deletion is blind.** `replace_placeholder_inner` fires N backspaces assuming the cursor is
  still after the placeholder. If the user typed or clicked elsewhere mid-dictation, those backspaces eat
  real text.
- **Dead code**: eleven unused components in `src/components/`, `ax.rs`'s geometry helpers, `term_exists`,
  `selected_parakeet_spec`, and `generate_phonetic` (no caller since the vocab prompt was removed). Four
  unreachable locale blocks (`es`/`fr`/`de`/`ja`) in `i18n.tsx` — `translationAlias` only maps en/zh/sv/fi.
- **CI runs no lint, typecheck, or clippy** — `release.yml` only builds. `npm run lint` currently fails on
  app code, and eslint has no ignore for `src-tauri/target`, so results shift depending on whether you built.

## Distribution

**Not shippable to the Mac App Store as architected** — the core mechanism is incompatible. MAS requires
App Sandbox; the app has none, plus three entitlements MAS forbids (`disable-library-validation`,
`allow-unsigned-executable-memory`, `allow-jit`). Auto-paste drives other processes via Accessibility and
synthesized `CGEvent`s, the global hotkey uses `addGlobalMonitorForEventsMatchingMask`, the updater
self-updates, and `binaries/llama-cli-*` ships a standalone executable — none of which a sandboxed MAS app
may do. Developer ID + notarization is the distribution path.

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

App data directory holds `dictate-ai.db` (SQLite) with tables: `settings`, `vocabulary`, `transcription_history`. Notable setting keys: `hotkey`, `hotkey_mode`, `speech_model`, `rewrite_model`, `rewrite_thinking_level`, `language`, `auto_paste`, `sound_enabled`, `max_recording_seconds`, `max_history_context`.

**API keys are not in the DB.** They live in the macOS Keychain under service `com.dictateai.app`; a startup migration moves any left over from older versions and blanks the row. History is auto-pruned after 30 days unless starred.

Vocabulary terms added by auto-learn carry category `learned`. Auto-learn diffs a pasted dictation against the user's edit, keeps substitutions that look like mis-hearings (normalized edit distance <= 0.65, under half the words changed), and adds them silently — no prompt.

## Releases & Updates

DictateAI uses Tauri's updater. Installed apps check GitHub Releases (`junior-building-things/DictateAI`) `latest.json` on launch, download in the background, and apply on next open. Initial install is from the website DMG.

**To publish an update:**
1. Bump the version in **all four**: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/i18n.tsx` (which repeats it once per locale block — bump every occurrence).
2. Commit and push.
3. Create and push a git tag like `v1.0.12`.
4. `.github/workflows/release.yml` builds the macOS bundle + DMG, packages and signs `DictateAI.app.tar.gz` with `tauri signer`, and uploads `latest.json`.

The updater private key is in GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` (the public key is embedded in the app).

**One version, one binary.** Never let two different builds share a version number — bump before rebuilding, even for a throwaway local build. Otherwise the DMG on the download site, the CI-built release, and whatever is on your machine all claim the same version while differing.

**Always build with the Developer ID identity.** Without it Tauri falls back to ad-hoc signing, which
breaks two things that are keyed to code identity: the Keychain ACL on the stored API keys (macOS raises
the alarming "DictateAI wants to use your confidential information" dialog), and the TCC grants for
Microphone / Accessibility (they have to be given again after every install). Ad-hoc identity also changes
on every rebuild, so "Always Allow" never sticks.

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Thomas Oefverstroem (Q2V7263T69)" npm run tauri build
```

Check any build before handing it out — `Signature=adhoc` means it went out wrong:

```bash
codesign -dvvv src-tauri/target/release/bundle/macos/DictateAI.app 2>&1 | grep -E "Authority|Signature"
```

A public release must never ship ad-hoc or under a different Team ID: the Keychain ACL is bound to the
signing identity, so existing users would all get that dialog on first launch after the update. Renewing
the Developer ID cert is safe (Team ID stays `Q2V7263T69`); switching Apple accounts is not.

**Local builds are signed but not notarized.** With the identity above, Gatekeeper accepts the app when it's installed from a local path and code identity stays stable, so Keychain and TCC grants persist. Notarization is separate and only matters for a DMG people download — an un-notarized DMG fetched over the internet still gets quarantined. Settings and history live in the app data dir, not the bundle, so they survive any reinstall.

---

## How Claude Should Work on This Codebase

The general working rules — think before coding, simplicity first, surgical changes, goal-driven
execution — live in `~/.claude/CLAUDE.md` and apply here. Only the repo-specific rule below is local.

### Commits, Pushes, and Releases
This is an installed desktop app, not an auto-deployed web app — **do not commit or push unless the user asks.** Work on the current branch; don't switch or rename branches without being told.

When you do ship a version, follow the release checklist above: bump the version in all four files, then tag `vX.Y.Z` to trigger the GitHub Actions release. Never push a tag without the user's go-ahead — it publishes an update to every installed app.
