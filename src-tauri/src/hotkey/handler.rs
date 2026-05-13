use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::audio::capture::AudioCaptureHandle;
use crate::audio::feedback;
use crate::db::settings;
use crate::error::AppResult;
use crate::processing_mode::{self, SPEECH_MODEL_PARAKEET_LOCAL};
use crate::state::{AppState, STATE_IDLE, STATE_PROCESSING, STATE_RECORDING};
use crate::transcribe::local::parakeet::{ParakeetEngine, ParakeetModelPaths};
use crate::transcribe::local::streaming::{self, StreamingHandle};

const MIN_RECORDING_DURATION_MS: u128 = 300;

pub struct HotkeyState {
    pub press_time: Mutex<Option<Instant>>,
    pub audio_capture: AudioCaptureHandle,
    pub streaming: Mutex<Option<StreamingHandle>>,
}

impl HotkeyState {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            press_time: Mutex::new(None),
            audio_capture: AudioCaptureHandle::new()?,
            streaming: Mutex::new(None),
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

    // Show overlay with "Listening..."
    crate::overlay::show(app, "listening");

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

    maybe_start_streaming(app, hotkey_state, app_state);
}

/// If the user picked Parakeet local + streaming is enabled, kick off the
/// background task that emits `transcription-partial` events while recording.
/// Best-effort: any failure here just means no partials.
fn maybe_start_streaming(app: &AppHandle, hotkey_state: &HotkeyState, app_state: &AppState) {
    let (speech_model, streaming_enabled) = {
        let db = app_state.db.lock().unwrap();
        let model = settings::get(&db, "speech_model").unwrap_or_default();
        let enabled = settings::get(&db, "parakeet_streaming")
            .unwrap_or_else(|_| "true".into())
            == "true";
        (model, enabled)
    };

    if speech_model != SPEECH_MODEL_PARAKEET_LOCAL || !streaming_enabled {
        return;
    }

    let engine = match resolve_or_load_parakeet(app, app_state) {
        Ok(e) => e,
        Err(e) => {
            log::debug!("streaming engine not available: {}", e);
            return;
        }
    };

    let handle = streaming::start(app.clone(), hotkey_state.audio_capture.clone(), engine);
    let mut guard = hotkey_state.streaming.lock().unwrap();
    if let Some(existing) = guard.replace(handle) {
        existing.stop();
    }
}

fn resolve_or_load_parakeet(
    app: &AppHandle,
    app_state: &AppState,
) -> AppResult<Arc<ParakeetEngine>> {
    {
        let guard = app_state.parakeet_engine.lock().unwrap();
        if let Some(e) = guard.as_ref() {
            return Ok(Arc::clone(e));
        }
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::Config(format!("App data dir: {}", e)))?;
    let spec_id = "parakeet-tdt-0.6b-v2-int8";
    let spec = crate::transcribe::local::download::find_model(spec_id).ok_or_else(|| {
        crate::error::AppError::Config("Parakeet spec not registered".into())
    })?;
    let dir = crate::transcribe::local::download::model_dir(&app_data_dir, spec);
    let engine = Arc::new(ParakeetEngine::load(&ParakeetModelPaths::new(dir))?);
    let mut guard = app_state.parakeet_engine.lock().unwrap();
    *guard = Some(Arc::clone(&engine));
    Ok(engine)
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

    // Signal the streaming task (if any) to stop so it doesn't keep firing
    // partial events after the final transcription lands.
    if let Some(handle) = hotkey_state.streaming.lock().unwrap().take() {
        handle.stop();
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
            crate::overlay::hide(app);
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
            crate::overlay::hide(app);
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
                crate::overlay::hide(app);
                if sound_enabled(app_state) {
                    let _ = feedback::play_error();
                }
                None
            } else {
                log::info!("Captured {} audio samples", audio_data.len());
                app_state.set_state(STATE_PROCESSING);
                let _ = tauri::Emitter::emit(app, "state-changed", "processing");
                crate::overlay::show(app, "rewriting");
                Some(audio_data)
            }
        }
        Err(e) => {
            log::error!("Failed to stop recording: {}", e);
            app_state.set_state(STATE_IDLE);
            crate::overlay::hide(app);
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

fn max_recording_duration_ms(app_state: &AppState) -> u128 {
    let db = app_state.db.lock().unwrap();
    settings::get(&db, "max_recording_seconds")
        .ok()
        .and_then(|v| v.parse::<u128>().ok())
        .filter(|v| *v > 0)
        .map(|v| v * 1000)
        .unwrap_or(120_000)
}
