use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, timeout, Duration, Instant};

use crate::audio::feedback;
use crate::db::{history, settings, vocabulary};
use crate::error::AppError;
use crate::error::AppResult;
use crate::on_device;
use crate::paste;
use crate::processing_mode::{self, ProcessingMode};
use crate::rewrite::{gemini, prompt};
use crate::state::{AppState, STATE_IDLE, STATE_PROCESSING};
use crate::transcribe::api::{self as speech_api, SpeechApiSettings};

const API_SPEECH_TIMEOUT_SECONDS: u64 = 8;
const ON_DEVICE_SPEECH_TIMEOUT_SECONDS: u64 = 20;
const API_REWRITE_TIMEOUT_SECONDS: u64 = 10;
const ON_DEVICE_REWRITE_TIMEOUT_SECONDS: u64 = 12;

pub async fn run(app: AppHandle, audio_data: Vec<f32>) -> AppResult<()> {
    let state = app.state::<AppState>();
    let processing_started_at = Instant::now();
    let run_id = state.begin_processing_run();

    // Set state to processing
    state.set_state(STATE_PROCESSING);
    let _ = app.emit("state-changed", "processing");

    // Switch overlay to "Rewriting..."
    crate::overlay::show(&app, "rewriting");

    let result = run_inner(&app, &state, audio_data, run_id).await;

    if state.is_run_current(run_id) {
        // Prevent UI flicker when processing finishes very quickly.
        let min_display = Duration::from_millis(450);
        let elapsed = processing_started_at.elapsed();
        if elapsed < min_display {
            sleep(min_display - elapsed).await;
        }
    }

    // Only the active run should own overlay cleanup.
    if state.is_run_current(run_id) {
        state.set_state(STATE_IDLE);
        let _ = app.emit("state-changed", "idle");
        crate::overlay::hide(&app);
    }

    if let Err(ref e) = result {
        if state.is_run_current(run_id) {
            log::error!("Pipeline error: {}", e);
            if sound_enabled(&state) && !is_cancellation_error(e) {
                let _ = feedback::play_error();
            }
            if !is_cancellation_error(e) {
                let _ = app.emit("pipeline-error", e.to_string());
            }
        }
    }

    if matches!(result, Err(ref e) if is_cancellation_error(e)) {
        return Ok(());
    }

    result
}

async fn run_inner(
    app: &AppHandle,
    state: &AppState,
    audio_data: Vec<f32>,
    run_id: u64,
) -> AppResult<()> {
    let e2e_started_at = Instant::now();
    let audio_duration_ms = (audio_data.len() as f64 / 16000.0 * 1000.0) as i64;

    // Normalize audio to ensure good signal level for whisper
    let audio_data = normalize_audio(audio_data);

    // Step 1: Transcribe
    log::info!("Transcribing {} samples...", audio_data.len());
    let language = {
        let db = state.db.lock().unwrap();
        settings::get(&db, "language").unwrap_or_else(|_| "en".to_string())
    };

    let mode_resolution = processing_mode::resolve(app, state).ok_or_else(|| {
        AppError::Config(
            "No processing mode is currently available. Add your OpenAI speech key or download the on-device models.".into(),
        )
    })?;
    if mode_resolution.fell_back_from_on_device {
        log::info!("On-device mode unavailable, falling back to API mode.");
    }

    let speech_settings = {
        let db = state.db.lock().unwrap();
        SpeechApiSettings {
            openai_api_key: settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
            google_api_key: settings::get(&db, "speech_google_api_key").unwrap_or_default(),
            google_project_id: settings::get(&db, "speech_google_project_id").unwrap_or_default(),
            google_region: settings::get(&db, "speech_google_region").unwrap_or_else(|_| "us".into()),
            doubao_access_token: settings::get(&db, "speech_doubao_access_token").unwrap_or_default(),
            doubao_app_id: settings::get(&db, "speech_doubao_app_id").unwrap_or_default(),
            doubao_cluster: settings::get(&db, "speech_doubao_cluster")
                .unwrap_or_else(|_| "byteplus_input".into()),
        }
    };

    let speech_started_at = Instant::now();
    let (raw_text, model_used) = if matches!(mode_resolution.mode, ProcessingMode::OnDevice) {
        let raw_text = timeout(
            Duration::from_secs(ON_DEVICE_SPEECH_TIMEOUT_SECONDS),
            on_device::transcribe(app, audio_data.clone(), language.clone()),
        )
        .await
        .map_err(|_| {
            AppError::Config(format!(
                "On-device transcription timed out after {} seconds.",
                ON_DEVICE_SPEECH_TIMEOUT_SECONDS
            ))
        })??;
        (
            raw_text,
            "whisper.cpp + llama.cpp".to_string(),
        )
    } else {
        let speech_model = "gpt-4o-mini-transcribe".to_string();
        let raw_text = timeout(
            Duration::from_secs(API_SPEECH_TIMEOUT_SECONDS),
            speech_api::transcribe(&audio_data, &language, &speech_model, speech_settings),
        )
        .await
        .map_err(|_| {
            AppError::Config(format!(
                "Speech transcription timed out after {} seconds.",
                API_SPEECH_TIMEOUT_SECONDS
            ))
        })??;
        (
            raw_text,
            "gpt-4o-mini-transcribe + gemini-2.5-flash-lite".to_string(),
        )
    };
    log::info!(
        "Speech phase completed in {:.2}s",
        speech_started_at.elapsed().as_secs_f64()
    );
    ensure_run_current(state, run_id)?;

    if raw_text.is_empty() {
        log::warn!("Empty transcription, skipping");
        return Ok(());
    }

    let _ = app.emit("transcription-complete", &raw_text);

    // Step 2: Get context from database
    let (
        vocab_terms,
        system_prompt_template,
        translation_language,
        spoken_language,
        api_key,
    ) = {
        let db = state.db.lock().unwrap();
        let vocab_terms = vocabulary::get_all(&db)?;
        let custom_prompt = settings::get(&db, "rewrite_system_prompt").unwrap_or_default();
        let system_prompt_template = if custom_prompt.trim().is_empty() {
            prompt::default_system_instruction().to_string()
        } else {
            custom_prompt
        };
        let translation_language =
            settings::get(&db, "translation_language").unwrap_or_else(|_| "same".into());
        let spoken_language = settings::get(&db, "language").unwrap_or_else(|_| "en".into());
        let api_key = settings::get(&db, "gemini_api_key").unwrap_or_default();
        (
            vocab_terms,
            system_prompt_template,
            translation_language,
            spoken_language,
            api_key,
        )
    };

    // Step 3: Rewrite
    let rewritten = if matches!(mode_resolution.mode, ProcessingMode::OnDevice) {
        let mut system_prompt_template = system_prompt_template.clone();
        if translation_language != "same" && translation_language != spoken_language {
            system_prompt_template.push_str(&format!(
                "\n\nTranslate final output to {}.",
                language_label(&translation_language)
            ));
        }

        let (system_prompt, user_message) =
            prompt::build_prompt(&system_prompt_template, &raw_text, &vocab_terms);

        let rewrite_started_at = Instant::now();
        match timeout(
            Duration::from_secs(ON_DEVICE_REWRITE_TIMEOUT_SECONDS),
            on_device::rewrite(app, system_prompt, user_message),
        )
        .await
        {
            Ok(Ok(text)) => {
                ensure_run_current(state, run_id)?;
                log::info!(
                    "On-device rewrite completed in {:.2}s",
                    rewrite_started_at.elapsed().as_secs_f64()
                );
                text
            }
            Ok(Err(e)) => {
                ensure_run_current(state, run_id)?;
                log::error!("On-device rewrite failed, falling back to raw text: {}", e);
                let _ = app.emit("rewrite-error", e.to_string());
                raw_text.clone()
            }
            Err(_) => {
                ensure_run_current(state, run_id)?;
                let message = format!(
                    "On-device rewrite timed out after {} seconds. Using raw transcription.",
                    ON_DEVICE_REWRITE_TIMEOUT_SECONDS
                );
                log::warn!("{}", message);
                let _ = app.emit("rewrite-error", &message);
                raw_text.clone()
            }
        }
    } else {
        if api_key.is_empty() {
            log::warn!("No Gemini API key configured, using raw transcription");
            raw_text.clone()
        } else {
            let mut system_prompt_template = system_prompt_template.clone();
            if translation_language != "same" && translation_language != spoken_language {
                system_prompt_template.push_str(&format!(
                    "\n\nTranslate final output to {}.",
                    language_label(&translation_language)
                ));
            }

            let (system_prompt, user_message) = prompt::build_prompt(
                &system_prompt_template,
                &raw_text,
                &vocab_terms,
            );

            let rewrite_started_at = Instant::now();
            match timeout(
                Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                gemini::rewrite(
                    &api_key,
                    "gemini-2.5-flash-lite",
                    &system_prompt,
                    &user_message,
                ),
            )
            .await
            {
                Ok(Ok(text)) => {
                    ensure_run_current(state, run_id)?;
                    log::info!(
                        "Gemini rewrite completed in {:.2}s",
                        rewrite_started_at.elapsed().as_secs_f64()
                    );
                    text
                }
                Ok(Err(e)) => {
                    ensure_run_current(state, run_id)?;
                    log::error!("Gemini rewrite failed, falling back to raw text: {}", e);
                    let _ = app.emit("rewrite-error", e.to_string());
                    raw_text.clone()
                }
                Err(_) => {
                    ensure_run_current(state, run_id)?;
                    return Err(AppError::Config(format!(
                        "Gemini rewrite timed out after {} seconds.",
                        API_REWRITE_TIMEOUT_SECONDS
                    )));
                }
            }
        }
    };
    ensure_run_current(state, run_id)?;

    // Step 4: Save to history
    ensure_run_current(state, run_id)?;
    {
        let db = state.db.lock().unwrap();
        history::insert_entry(&db, &raw_text, &rewritten, &model_used, audio_duration_ms)?;
        let rewritten_lower = rewritten.to_lowercase();
        for term in &vocab_terms {
            if rewritten_lower.contains(&term.term.to_lowercase()) {
                let _ = vocabulary::increment_use_count(&db, term.id);
            }
        }
    }

    // Step 5: Paste
    let auto_paste = {
        let db = state.db.lock().unwrap();
        settings::get(&db, "auto_paste").unwrap_or_else(|_| "true".into()) == "true"
    };

    if auto_paste {
        ensure_run_current(state, run_id)?;
        paste::clipboard::write_text(app, &rewritten)?;
        ensure_run_current(state, run_id)?;

        // Simulate Cmd+V paste using CGEvent (thread-safe on macOS)
        match paste::simulate::paste() {
            Ok(()) => {}
            Err(e) => {
                log::error!("Paste failed: {}. Text is on clipboard — paste manually with Cmd+V.", e);
                let _ = app.emit("paste-error", format!(
                    "Auto-paste failed: {}. Text is on clipboard — paste manually with Cmd+V.",
                    e
                ));
            }
        }
    }

    // Step 6: Play completion sound
    ensure_run_current(state, run_id)?;
    if sound_enabled(state) {
        let _ = feedback::play_complete();
    }
    let _ = app.emit("pipeline-complete", &rewritten);

    log::info!(
        "E2E processing completed in {:.2}s",
        e2e_started_at.elapsed().as_secs_f64()
    );
    log::info!("Pipeline complete: \"{}\" -> \"{}\"", raw_text, rewritten);
    Ok(())
}

fn ensure_run_current(state: &AppState, run_id: u64) -> AppResult<()> {
    if state.is_run_current(run_id) {
        Ok(())
    } else {
        Err(AppError::Config("Processing cancelled.".into()))
    }
}

fn is_cancellation_error(error: &AppError) -> bool {
    matches!(error, AppError::Config(message) if message == "Processing cancelled.")
}

fn sound_enabled(state: &AppState) -> bool {
    let db = state.db.lock().unwrap();
    settings::get(&db, "sound_enabled")
        .map(|v| v == "true")
        .unwrap_or(true)
}

fn language_label(code: &str) -> &str {
    match code {
        "en" => "English",
        "es" => "Spanish",
        "fr" => "French",
        "de" => "German",
        "ja" => "Japanese",
        "zh" => "Chinese",
        "sv" => "Swedish",
        "fi" => "Finnish",
        _ => "the selected language",
    }
}

/// Process audio for whisper: apply noise gate, trim silence, and normalize.
fn normalize_audio(mut audio: Vec<f32>) -> Vec<f32> {
    let max_amp = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

    if max_amp < 0.001 {
        // Audio is essentially silence, don't amplify noise
        return audio;
    }

    // Step 1: Compute noise floor from the first 50ms (800 samples at 16kHz)
    // This is typically before the user starts speaking
    let noise_window = 800.min(audio.len());
    let noise_rms = (audio[..noise_window]
        .iter()
        .map(|s| s * s)
        .sum::<f32>()
        / noise_window as f32)
        .sqrt();
    let noise_gate_threshold = (noise_rms * 3.0).max(0.002);
    log::info!(
        "Audio pre-processing: max_amp={:.4}, noise_rms={:.6}, gate_threshold={:.4}",
        max_amp,
        noise_rms,
        noise_gate_threshold
    );

    // Step 2: Apply soft noise gate — attenuate samples below threshold
    for sample in audio.iter_mut() {
        let abs = sample.abs();
        if abs < noise_gate_threshold {
            *sample *= 0.1; // Attenuate noise, don't hard-cut to avoid artifacts
        }
    }

    // Step 3: Trim leading and trailing silence
    let energy_threshold = noise_gate_threshold * 2.0;
    let window_size = 160; // 10ms at 16kHz
    let start = audio
        .chunks(window_size)
        .position(|chunk| {
            let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
            rms > energy_threshold
        })
        .unwrap_or(0)
        * window_size;
    let end = audio.len()
        - audio
            .chunks(window_size)
            .rev()
            .position(|chunk| {
                let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
                rms > energy_threshold
            })
            .unwrap_or(0)
            * window_size;

    if start < end {
        // Add a small margin (100ms = 1600 samples) on each side
        let margin = 1600;
        let start = start.saturating_sub(margin);
        let end = (end + margin).min(audio.len());
        audio = audio[start..end].to_vec();
        log::info!(
            "Trimmed silence: {}→{} samples ({:.2}s)",
            start,
            end,
            audio.len() as f64 / 16000.0
        );
    }

    // Step 4: Normalize peak amplitude
    let max_amp = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if max_amp > 0.001 && max_amp < 0.5 {
        let gain = (0.5 / max_amp).min(10.0);
        log::info!(
            "Normalizing audio: max_amp={:.4}, applying gain={:.2}x",
            max_amp,
            gain
        );
        for sample in audio.iter_mut() {
            *sample *= gain;
        }
    }

    audio
}
