use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::audio::capture::AudioCaptureHandle;
use crate::audio::feedback;
use crate::db::settings;
use crate::error::AppResult;
use crate::paste;
use crate::processing_mode;
use crate::state::{AppState, STATE_IDLE, STATE_PROCESSING, STATE_RECORDING};

const MIN_RECORDING_DURATION_MS: u128 = 300;

/// Text typed into the focused field when recording starts. The pipeline
/// replaces it with the final rewrite, or deletes it if the rewrite fails /
/// is empty.
pub const RECORDING_PLACEHOLDER: &str = "Listening...";

pub struct HotkeyState {
    pub press_time: Mutex<Option<Instant>>,
    pub audio_capture: AudioCaptureHandle,
}

impl HotkeyState {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            press_time: Mutex::new(None),
            audio_capture: AudioCaptureHandle::new()?,
        })
    }
}

pub fn on_pressed(app: &AppHandle, hotkey_state: &HotkeyState, app_state: &AppState) {
    // Only start if we're idle
    if !app_state.is_idle() {
        return;
    }

    let Some(mode_resolution) = processing_mode::resolve(app, app_state) else {
        log::info!("Hotkey ignored: no processing mode is currently available.");
        return;
    };
    let _ = mode_resolution;

    // Record press time
    {
        let mut press_time = hotkey_state.press_time.lock().unwrap();
        *press_time = Some(Instant::now());
    }

    // Set state to recording
    app_state.set_state(STATE_RECORDING);

    // Emit state change event
    let _ = tauri::Emitter::emit(app, "state-changed", "recording");

    // Play start sound when enabled
    if sound_enabled(app_state) {
        if let Err(e) = feedback::play_start() {
            log::error!("Failed to play start sound: {}", e);
        }
    }

    // Start audio capture
    if let Err(e) = hotkey_state.audio_capture.start() {
        log::error!("Failed to start recording: {}", e);
        app_state.set_state(STATE_IDLE);
        let _ = tauri::Emitter::emit(app, "state-changed", "idle");
        if sound_enabled(app_state) {
            let _ = feedback::play_error();
        }
        return;
    }

    // Type the "Listening..." placeholder into the focused field if auto-paste
    // is on. The pipeline replaces it with the final rewrite (or deletes it on
    // failure). Best-effort: if accessibility isn't granted or the focused
    // surface rejects input, we just skip the placeholder and let the pipeline
    // paste at the end as before.
    let auto_paste = auto_paste_enabled(app_state);
    log::info!(
        "Hotkey press: auto_paste={}, scheduling placeholder",
        auto_paste
    );
    if auto_paste {
        let is_toggle = {
            let db = app_state.db.lock().unwrap();
            settings::get(&db, "hotkey_mode")
                .map(|v| v == "toggle")
                .unwrap_or(false)
        };
        // Placeholder is toggle-mode only. In hold mode we just paste the
        // final rewrite when the pipeline finishes — no "Listening..." chip.
        // The OS hotkey grab blocks every userland injection strategy we
        // tried during the hold period, so the placeholder UX added no
        // value (it would only appear during the brief pipeline phase
        // anyway, which doesn't read as recording feedback).
        if !is_toggle {
            return;
        }

        let app_for_placeholder = app.clone();
        tauri::async_runtime::spawn(async move {
            // Wait for the tap key to fully release before we synthesize
            // keystrokes — otherwise the OS hotkey grab swallows them.
            // 100ms tested as not enough; 200ms is the empirical minimum
            // that works reliably across human tap durations.
            tokio::time::sleep(Duration::from_millis(200)).await;
            let state = app_for_placeholder.state::<AppState>();
            if !state.is_recording() {
                return;
            }
            match paste::simulate::insert_text(RECORDING_PLACEHOLDER) {
                Ok(()) => {
                    let len = RECORDING_PLACEHOLDER.chars().count();
                    *state.pending_placeholder.lock().unwrap() = Some(len);
                    log::info!("Inserted placeholder ({} chars)", len);
                }
                Err(e) => {
                    log::warn!("Could not insert recording placeholder: {}", e);
                }
            }
        });
    } else {
        log::info!("auto_paste disabled, skipping placeholder");
    }
}


pub fn on_released(
    app: &AppHandle,
    hotkey_state: &HotkeyState,
    app_state: &AppState,
) -> Option<Vec<f32>> {
    // Only process if we're recording
    if !app_state.is_recording() {
        return None;
    }

    // Check duration - ignore very short presses
    let duration = {
        let press_time = hotkey_state.press_time.lock().unwrap();
        press_time.map(|t| t.elapsed().as_millis())
    };

    if let Some(dur) = duration {
        if dur < MIN_RECORDING_DURATION_MS {
            log::info!("Press too short ({}ms), ignoring", dur);
            app_state.set_state(STATE_IDLE);
            cleanup_placeholder(app_state);
            // Still need to stop the stream
            let _ = hotkey_state.audio_capture.stop();
            return None;
        }

        let max_duration_ms = max_recording_duration_ms(app_state);
        if dur > max_duration_ms {
            log::warn!(
                "Recording exceeded max duration ({}ms > {}ms), discarding",
                dur,
                max_duration_ms
            );
            app_state.set_state(STATE_IDLE);
            cleanup_placeholder(app_state);
            let _ = hotkey_state.audio_capture.stop();
            let _ = tauri::Emitter::emit(
                app,
                "pipeline-error",
                format!(
                    "Recording exceeded maximum duration ({:.0}s).",
                    max_duration_ms as f64 / 1000.0
                ),
            );
            if sound_enabled(app_state) {
                let _ = feedback::play_error();
            }
            return None;
        }
    }

    // Play stop sound when enabled
    if sound_enabled(app_state) {
        if let Err(e) = feedback::play_stop() {
            log::error!("Failed to play stop sound: {}", e);
        }
    }

    // Stop audio capture and get the buffer
    match hotkey_state.audio_capture.stop() {
        Ok(audio_data) => {
            if audio_data.is_empty() {
                log::warn!("No audio data captured");
                app_state.set_state(STATE_IDLE);
                cleanup_placeholder(app_state);
                if sound_enabled(app_state) {
                    let _ = feedback::play_error();
                }
                None
            } else {
                log::info!("Captured {} audio samples", audio_data.len());
                app_state.set_state(STATE_PROCESSING);
                let _ = tauri::Emitter::emit(app, "state-changed", "processing");
                Some(audio_data)
            }
        }
        Err(e) => {
            log::error!("Failed to stop recording: {}", e);
            app_state.set_state(STATE_IDLE);
            cleanup_placeholder(app_state);
            if sound_enabled(app_state) {
                let _ = feedback::play_error();
            }
            None
        }
    }
}

fn sound_enabled(app_state: &AppState) -> bool {
    let db = app_state.db.lock().unwrap();
    settings::get(&db, "sound_enabled")
        .map(|v| v == "true")
        .unwrap_or(true)
}

fn auto_paste_enabled(app_state: &AppState) -> bool {
    let db = app_state.db.lock().unwrap();
    settings::get(&db, "auto_paste")
        .ok()
        .or_else(|| settings::get(&db, "auto_copy").ok())
        .map(|v| v == "true")
        .unwrap_or(true)
}

/// Remove any leftover "Listening..." placeholder when we bail before
/// reaching the pipeline (short press, max duration, capture error).
fn cleanup_placeholder(app_state: &AppState) {
    if let Some(len) = app_state.pending_placeholder.lock().unwrap().take() {
        if let Err(e) = paste::simulate::delete_placeholder(len) {
            log::warn!("Could not delete recording placeholder: {}", e);
        }
    }
}

fn max_recording_duration_ms(app_state: &AppState) -> u128 {
    let db = app_state.db.lock().unwrap();
    settings::get(&db, "max_recording_seconds")
        .ok()
        .and_then(|v| v.parse::<u128>().ok())
        .filter(|v| *v > 0)
        .map(|v| v * 1000)
        .unwrap_or(120_000)
}
