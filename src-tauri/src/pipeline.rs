use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, timeout, Duration, Instant};

use crate::audio::feedback;
use crate::db::{history, settings, vocabulary};
use crate::error::AppError;
use crate::error::AppResult;
use crate::paste;
use crate::processing_mode;
use crate::rewrite::{alibaba, gemini, local_cleanup, openai, prompt};
use crate::state::{AppState, STATE_IDLE, STATE_PROCESSING};
use crate::transcribe::api::{self as speech_api, SpeechApiSettings};

const API_SPEECH_TIMEOUT_SECONDS: u64 = 8;
const API_REWRITE_TIMEOUT_SECONDS: u64 = 10;

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

    // Normalize audio to ensure good signal level for transcription.
    let audio_data = normalize_audio(audio_data);

    // Step 1: Transcribe
    log::info!("Transcribing {} samples...", audio_data.len());
    let language = {
        let db = state.db.lock().unwrap();
        settings::get(&db, "language").unwrap_or_else(|_| "en".to_string())
    };

    let mode_resolution = processing_mode::resolve(app, state).ok_or_else(|| {
        AppError::Config(
            "No speech model is currently available. Configure a supported speech provider in Models.".into(),
        )
    })?;
    let _ = mode_resolution;

    let (selected_speech_model, speech_settings) = {
        let db = state.db.lock().unwrap();
        (
            settings::get(&db, "speech_model").unwrap_or_else(|_| "deepgram-nova-3".into()),
            SpeechApiSettings {
                deepgram_api_key: settings::get(&db, "speech_deepgram_api_key").unwrap_or_default(),
                openai_api_key: settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
                google_api_key: settings::get(&db, "speech_google_api_key").unwrap_or_default(),
                google_project_id: settings::get(&db, "speech_google_project_id")
                    .unwrap_or_default(),
                google_region: settings::get(&db, "speech_google_region")
                    .unwrap_or_else(|_| "us".into()),
                nvidia_base_url: settings::get(&db, "speech_nvidia_base_url").unwrap_or_default(),
                nvidia_api_key: settings::get(&db, "speech_nvidia_api_key").unwrap_or_default(),
                alibaba_api_key: settings::get(&db, "alibaba_api_key").unwrap_or_default(),
                alibaba_base_url: settings::get(&db, "alibaba_base_url").unwrap_or_else(|_| {
                    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".into()
                }),
                doubao_access_token: settings::get(&db, "speech_doubao_access_token")
                    .unwrap_or_default(),
                doubao_app_id: settings::get(&db, "speech_doubao_app_id").unwrap_or_default(),
                doubao_cluster: settings::get(&db, "speech_doubao_cluster")
                    .unwrap_or_else(|_| "byteplus_input".into()),
            },
        )
    };

    let speech_started_at = Instant::now();
    let raw_text = timeout(
        Duration::from_secs(API_SPEECH_TIMEOUT_SECONDS),
        speech_api::transcribe(
            &audio_data,
            &language,
            &selected_speech_model,
            speech_settings,
        ),
    )
    .await
    .map_err(|_| {
        AppError::Config(format!(
            "Speech transcription timed out after {} seconds.",
            API_SPEECH_TIMEOUT_SECONDS
        ))
    })??;
    let speech_model_used = selected_speech_model.clone();
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
        has_active_custom_prompt,
        favorite_examples,
        translation_language,
        spoken_language,
        openai_api_key,
        gemini_api_key,
        alibaba_api_key,
        alibaba_base_url,
        rewrite_provider,
        rewrite_model,
        local_cleanup_options,
    ) = {
        let db = state.db.lock().unwrap();
        let use_vocabulary =
            settings::get(&db, "rewrite_use_vocabulary").unwrap_or_else(|_| "true".into()) == "true";
        let vocab_terms = if use_vocabulary {
            vocabulary::get_all(&db)?
        } else {
            Vec::new()
        };
        let custom_prompt = settings::get(&db, "rewrite_system_prompt").unwrap_or_default();
        let use_custom_prompt =
            settings::get(&db, "rewrite_use_custom_prompt").unwrap_or_else(|_| "false".into()) == "true";
        let rewrite_tone = settings::get(&db, "rewrite_tone").unwrap_or_else(|_| "neutral".into());
        let use_favorites =
            settings::get(&db, "rewrite_use_favorites").unwrap_or_else(|_| "false".into()) == "true";
        let has_active_custom_prompt = use_custom_prompt && !custom_prompt.trim().is_empty();
        let favorite_examples = if use_favorites {
            history::get_favorite_examples(&db, 8)?
        } else {
            Vec::new()
        };
        let system_prompt_template = if has_active_custom_prompt {
            custom_prompt
        } else {
            prompt::system_instruction_for_tone(&rewrite_tone)
        };
        let translation_language =
            settings::get(&db, "translation_language").unwrap_or_else(|_| "same".into());
        let spoken_language = settings::get(&db, "language").unwrap_or_else(|_| "en".into());
        let openai_api_key = settings::get(&db, "speech_openai_api_key").unwrap_or_default();
        let gemini_api_key = settings::get(&db, "gemini_api_key").unwrap_or_default();
        let alibaba_api_key = settings::get(&db, "alibaba_api_key").unwrap_or_default();
        let alibaba_base_url = settings::get(&db, "alibaba_base_url")
            .unwrap_or_else(|_| "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".into());
        let rewrite_provider =
            settings::get(&db, "rewrite_provider").unwrap_or_else(|_| "Google".into());
        let rewrite_model =
            settings::get(&db, "rewrite_model").unwrap_or_else(|_| "gemini-2.5-flash-lite".into());
        let local_cleanup_options = local_cleanup::LocalCleanupOptions {
            filler: true,
            repeats: true,
            corrections: true,
            preserve: false,
            punctuation: true,
        };
        (
            vocab_terms,
            system_prompt_template,
            has_active_custom_prompt,
            favorite_examples,
            translation_language,
            spoken_language,
            openai_api_key,
            gemini_api_key,
            alibaba_api_key,
            alibaba_base_url,
            rewrite_provider,
            rewrite_model,
            local_cleanup_options,
        )
    };

    // Step 3: Rewrite
    let mut prepared_system_prompt = system_prompt_template.clone();
    if translation_language != "same" && translation_language != spoken_language {
        prepared_system_prompt.push_str(&format!(
            "\n\nTranslate final output to {}.",
            language_label(&translation_language)
        ));
    }

    if has_active_custom_prompt {
        log::info!("Using custom rewrite prompt; rewrite tone setting is ignored for this run");
    }

    let (system_prompt, user_message) =
        prompt::build_prompt(
            &prepared_system_prompt,
            &raw_text,
            &vocab_terms,
            &favorite_examples,
        );
    let rewrite_started_at = Instant::now();
    let (rewritten, rewrite_model_used) = match rewrite_provider.as_str() {
        "OpenAI" => {
            if openai_api_key.trim().is_empty() {
                emit_missing_rewrite_key(
                    app,
                    "OpenAI rewrite is selected, but no API key is configured. Using raw transcription.",
                );
                (raw_text.clone(), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    openai::rewrite(
                        &openai_api_key,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(text)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "OpenAI rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (text, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!("OpenAI rewrite failed, falling back to raw text: {}", error);
                        let _ = app.emit("rewrite-error", error.to_string());
                        (raw_text.clone(), "raw-transcription".to_string())
                    }
                    Err(_) => {
                        ensure_run_current(state, run_id)?;
                        return Err(AppError::Config(format!(
                            "OpenAI rewrite timed out after {} seconds.",
                            API_REWRITE_TIMEOUT_SECONDS
                        )));
                    }
                }
            }
        }
        "Google" => {
            if gemini_api_key.trim().is_empty() {
                emit_missing_rewrite_key(
                    app,
                    "Google rewrite is selected, but no Gemini API key is configured. Using raw transcription.",
                );
                (raw_text.clone(), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    gemini::rewrite(
                        &gemini_api_key,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(text)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "Google rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (text, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!("Google rewrite failed, falling back to raw text: {}", error);
                        let _ = app.emit("rewrite-error", error.to_string());
                        (raw_text.clone(), "raw-transcription".to_string())
                    }
                    Err(_) => {
                        ensure_run_current(state, run_id)?;
                        return Err(AppError::Config(format!(
                            "Google rewrite timed out after {} seconds.",
                            API_REWRITE_TIMEOUT_SECONDS
                        )));
                    }
                }
            }
        }
        "Alibaba" => {
            if alibaba_api_key.trim().is_empty() {
                emit_missing_rewrite_key(
                    app,
                    "Alibaba rewrite is selected, but no API key is configured. Using raw transcription.",
                );
                (raw_text.clone(), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    alibaba::rewrite(
                        &alibaba_api_key,
                        &alibaba_base_url,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(text)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "Alibaba rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (text, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!(
                            "Alibaba rewrite failed, falling back to raw text: {}",
                            error
                        );
                        let _ = app.emit("rewrite-error", error.to_string());
                        (raw_text.clone(), "raw-transcription".to_string())
                    }
                    Err(_) => {
                        ensure_run_current(state, run_id)?;
                        return Err(AppError::Config(format!(
                            "Alibaba rewrite timed out after {} seconds.",
                            API_REWRITE_TIMEOUT_SECONDS
                        )));
                    }
                }
            }
        }
        _ => (
            local_cleanup::rewrite(&raw_text, local_cleanup_options),
            "local-cleanup".to_string(),
        ),
    };
    ensure_run_current(state, run_id)?;
    let model_used = format!("{} + {}", speech_model_used, rewrite_model_used);

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

    // Step 5: Deliver output to the user
    let auto_paste = {
        let db = state.db.lock().unwrap();
        settings::get(&db, "auto_paste")
            .unwrap_or_else(|_| settings::get(&db, "auto_copy").unwrap_or_else(|_| "true".into()))
            == "true"
    };

    ensure_run_current(state, run_id)?;
    if auto_paste {
        paste::simulate::insert_text(&rewritten)?;
    } else {
        paste::simulate::copy_text(app, &rewritten)?;
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

fn emit_missing_rewrite_key(app: &AppHandle, message: &str) {
    log::warn!("{}", message);
    let _ = app.emit("rewrite-error", message);
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

/// Process audio for transcription: apply noise gate, trim silence, and normalize.
fn normalize_audio(mut audio: Vec<f32>) -> Vec<f32> {
    let max_amp = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

    if max_amp < 0.001 {
        // Audio is essentially silence, don't amplify noise
        return audio;
    }

    // Step 1: Compute noise floor from the first 50ms (800 samples at 16kHz)
    // This is typically before the user starts speaking
    let noise_window = 800.min(audio.len());
    let noise_rms =
        (audio[..noise_window].iter().map(|s| s * s).sum::<f32>() / noise_window as f32).sqrt();
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
