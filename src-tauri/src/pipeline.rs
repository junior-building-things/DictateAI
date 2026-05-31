use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{timeout, Duration, Instant};

use crate::audio::feedback;
use crate::db::{history, settings, vocabulary};
use crate::error::AppError;
use crate::error::AppResult;
use crate::paste;
use crate::processing_mode;
#[cfg(target_os = "macos")]
use crate::pricing;
use crate::rewrite::apple_fm;
use crate::rewrite::{alibaba, gemini, groq, local_cleanup, openai, prompt, RewriteOutcome};
use crate::transcribe::local::download::parakeet_spec_for;
use crate::state::{AppState, STATE_IDLE, STATE_PROCESSING};
use crate::transcribe::api::{self as speech_api, SpeechApiSettings};
use crate::transcribe::local::parakeet::{ParakeetEngine, ParakeetModelPaths};

const API_SPEECH_TIMEOUT_SECONDS: u64 = 8;
const API_REWRITE_TIMEOUT_SECONDS: u64 = 10;

pub async fn run(app: AppHandle, audio_data: Vec<f32>) -> AppResult<()> {
    let state = app.state::<AppState>();
    let run_id = state.begin_processing_run();

    // Set state to processing
    state.set_state(STATE_PROCESSING);
    let _ = app.emit("state-changed", "processing");

    let result = run_inner(&app, &state, audio_data, run_id).await;

    // Only the active run should own state cleanup.
    if state.is_run_current(run_id) {
        state.set_state(STATE_IDLE);
        let _ = app.emit("state-changed", "idle");

        // If the deliver step didn't consume the 🎙️ / ✏️ placeholder
        // (failure, empty rewrite, early return), wipe it now so the user
        // isn't left staring at it.
        let leftover = state.pending_placeholder.lock().unwrap().take();
        if let Some(len) = leftover {
            if let Err(e) = paste::simulate::delete_placeholder(len) {
                log::warn!("Could not delete recording placeholder: {}", e);
            }
        }
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
            settings::get(&db, "speech_model").unwrap_or_else(|_| "gpt-4o-mini-transcribe".into()),
            SpeechApiSettings {
                deepgram_api_key: settings::get(&db, "speech_deepgram_api_key").unwrap_or_default(),
                openai_api_key: settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
                groq_api_key: settings::get(&db, "speech_groq_api_key").unwrap_or_default(),
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
    let raw_text = if let Some(parakeet_spec) = parakeet_spec_for(&selected_speech_model) {
        let engine = ensure_parakeet_engine(app, state, parakeet_spec)?;
        let audio_owned = audio_data.clone();
        tokio::task::spawn_blocking(move || engine.transcribe(&audio_owned))
            .await
            .map_err(|e| {
                AppError::Config(format!("Parakeet inference task join failed: {}", e))
            })??
    } else {
        timeout(
            Duration::from_secs(API_SPEECH_TIMEOUT_SECONDS),
            speech_api::transcribe(
                &state.http_client,
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
        })??
    };
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
        groq_api_key,
        alibaba_api_key,
        alibaba_base_url,
        rewrite_provider,
        rewrite_model,
        local_cleanup_options,
    ) = {
        let db = state.db.lock().unwrap();
        let use_vocabulary = settings::get(&db, "rewrite_use_vocabulary")
            .unwrap_or_else(|_| "true".into())
            == "true";
        let vocab_terms = if use_vocabulary {
            vocabulary::get_all(&db)?
        } else {
            Vec::new()
        };
        let custom_prompt = settings::get(&db, "rewrite_system_prompt").unwrap_or_default();
        let use_custom_prompt = settings::get(&db, "rewrite_use_custom_prompt")
            .unwrap_or_else(|_| "false".into())
            == "true";
        let rewrite_tone = settings::get(&db, "rewrite_tone").unwrap_or_else(|_| "neutral".into());
        let use_favorites = settings::get(&db, "rewrite_use_favorites")
            .unwrap_or_else(|_| "false".into())
            == "true";
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
        let groq_api_key = settings::get(&db, "groq_api_key").unwrap_or_default();
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
            groq_api_key,
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

    let (system_prompt, user_message) = prompt::build_prompt(
        &prepared_system_prompt,
        &raw_text,
        &vocab_terms,
        &favorite_examples,
    );
    let rewrite_started_at = Instant::now();
    let (rewrite_outcome, rewrite_model_used) = match rewrite_provider.as_str() {
        "OpenAI" => {
            if openai_api_key.trim().is_empty() {
                emit_missing_rewrite_key(
                    app,
                    "OpenAI rewrite is selected, but no API key is configured. Using raw transcription.",
                );
                (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    openai::rewrite(
                        &state.http_client,
                        &openai_api_key,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(outcome)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "OpenAI rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (outcome, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!("OpenAI rewrite failed, falling back to raw text: {}", error);
                        let _ = app.emit("rewrite-error", error.to_string());
                        (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
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
                (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    gemini::rewrite(
                        &state.http_client,
                        &gemini_api_key,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(outcome)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "Google rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (outcome, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!("Google rewrite failed, falling back to raw text: {}", error);
                        let _ = app.emit("rewrite-error", error.to_string());
                        (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
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
        "Groq" => {
            if groq_api_key.trim().is_empty() {
                emit_missing_rewrite_key(
                    app,
                    "Groq rewrite is selected, but no API key is configured. Using raw transcription.",
                );
                (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    groq::rewrite(
                        &state.http_client,
                        &groq_api_key,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(outcome)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "Groq rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (outcome, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!("Groq rewrite failed, falling back to raw text: {}", error);
                        let _ = app.emit("rewrite-error", error.to_string());
                        (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
                    }
                    Err(_) => {
                        ensure_run_current(state, run_id)?;
                        return Err(AppError::Config(format!(
                            "Groq rewrite timed out after {} seconds.",
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
                (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
            } else {
                match timeout(
                    Duration::from_secs(API_REWRITE_TIMEOUT_SECONDS),
                    alibaba::rewrite(
                        &state.http_client,
                        &alibaba_api_key,
                        &alibaba_base_url,
                        &rewrite_model,
                        &system_prompt,
                        &user_message,
                    ),
                )
                .await
                {
                    Ok(Ok(outcome)) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "Alibaba rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (outcome, rewrite_model.clone())
                    }
                    Ok(Err(error)) => {
                        ensure_run_current(state, run_id)?;
                        log::error!(
                            "Alibaba rewrite failed, falling back to raw text: {}",
                            error
                        );
                        let _ = app.emit("rewrite-error", error.to_string());
                        (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
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
        "Apple" => {
            #[cfg(target_os = "macos")]
            {
                match apple_fm::rewrite(&system_prompt, &user_message).await {
                    Ok(outcome) => {
                        ensure_run_current(state, run_id)?;
                        log::info!(
                            "Apple FM rewrite completed in {:.2}s",
                            rewrite_started_at.elapsed().as_secs_f64()
                        );
                        (outcome, "apple-fm-system".to_string())
                    }
                    Err(error) => {
                        ensure_run_current(state, run_id)?;
                        log::error!(
                            "Apple FM rewrite failed, falling back to raw text: {}",
                            error
                        );
                        let _ = app.emit("rewrite-error", error.to_string());
                        (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                emit_missing_rewrite_key(
                    app,
                    "Apple Foundation Models is macOS-only. Using raw transcription.",
                );
                (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
            }
        }
        // Old "Local" llama.cpp rewrite path — Llama 3.2 1B and Gemma 3 1B were
        // removed from the catalog. Stale settings get migrated by schema.rs,
        // but the engine code is kept compiled so older builds can fall back
        // gracefully if a user finds a way to set the provider manually.
        "Local" => {
            log::warn!(
                "Local llama.cpp rewrite provider is deprecated; falling back to raw text"
            );
            let _ = app.emit(
                "rewrite-error",
                "The local llama.cpp rewrite models were removed. Switch to Apple, Groq, or Google.",
            );
            (RewriteOutcome::local(raw_text.clone()), "raw-transcription".to_string())
        }
        _ => (
            RewriteOutcome::local(local_cleanup::rewrite(&raw_text, local_cleanup_options)),
            "local-cleanup".to_string(),
        ),
    };
    ensure_run_current(state, run_id)?;
    // Defensive: strip one level of wrapping quotes if the model added them
    // despite the prompt. Common with small instruct models (Gemma 1B,
    // Llama 1B) that mirror few-shot example formatting.
    let rewritten = strip_wrapping_quotes(&rewrite_outcome.text);
    // Defensive: detect "no change" meta-commentary the model emitted instead
    // of echoing the input. Treat it as empty so the deliver step deletes the
    // placeholder and pastes nothing.
    let rewritten = if is_no_change_sentinel(&rewritten) {
        log::info!("Rewrite returned a no-change sentinel; treating as empty");
        String::new()
    } else {
        rewritten
    };
    let model_used = format!("{} + {}", speech_model_used, rewrite_model_used);

    // Usage telemetry — drives the Dashboard's Tokens + Cost tiles. Tokens
    // are rewrite-side only (speech APIs bill by minute, not by token).
    // Cost combines speech-phase per-minute + rewrite-phase per-token rates
    // from `pricing.rs`. Local / Apple FM rewrites contribute 0 tokens; the
    // raw-transcription fallback also costs nothing because no rewrite ran.
    let tokens = rewrite_outcome.total_tokens() as i64;
    let speech_cost = pricing::speech_cost_usd(&selected_speech_model, audio_duration_ms);
    let rewrite_cost = pricing::rewrite_cost_usd(&rewrite_model_used, &rewrite_outcome);
    let cost_usd = speech_cost + rewrite_cost;
    log::info!(
        "Usage: tokens={} (prompt={}, completion={}), cost=${:.5} (speech=${:.5}, rewrite=${:.5})",
        tokens, rewrite_outcome.prompt_tokens, rewrite_outcome.completion_tokens,
        cost_usd, speech_cost, rewrite_cost,
    );

    // Step 4: Save to history
    ensure_run_current(state, run_id)?;
    {
        let db = state.db.lock().unwrap();
        history::insert_entry(
            &db,
            &raw_text,
            &rewritten,
            &model_used,
            audio_duration_ms,
            tokens,
            cost_usd,
        )?;
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
        // If the hotkey handler typed a 🎙️ / ✏️ placeholder, swap it
        // for the rewrite in one step. Empty / whitespace-only rewrites get
        // left alone here — the outer cleanup deletes the placeholder so
        // the user isn't pasted with nothing.
        if !rewritten.trim().is_empty() {
            let placeholder_len = state.pending_placeholder.lock().unwrap().take();
            if let Some(len) = placeholder_len {
                paste::simulate::replace_placeholder(len, &rewritten)?;
            } else {
                // No placeholder was typed (hold mode, or accessibility
                // denied at press time). Slow path so apps with their own
                // IME handling don't drop characters.
                paste::simulate::insert_text_slow(&rewritten)?;
            }

            // Kick off the "learn-from-edits" watcher: poll the focused
            // text element via AX for the next minute; if the user edits
            // the paste, fire a `dictation-edited` event so the frontend
            // can offer to learn new proper-noun-shaped words as vocab.
            // No-op on non-macOS or when the user has the
            // `auto_add_vocabulary` preference off (checked inside).
            #[cfg(target_os = "macos")]
            spawn_edit_monitor(app.clone(), state, rewritten.clone());
        }
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
    // Log lengths only — full transcript text can contain sensitive content
    // (passwords, internal docs, etc.) that the user dictated by accident.
    // Use the in-app History page if you need to inspect actual text.
    log::info!(
        "Pipeline complete: raw={} chars, rewritten={} chars",
        raw_text.chars().count(),
        rewritten.chars().count()
    );
    Ok(())
}

/// Eagerly load the engines the user has selected so the first dictation
/// after launch doesn't pay the cold-start cost (~300-1000 ms depending on
/// model). Best-effort: anything that isn't ready (missing model files,
/// user on cloud STT/rewrite, etc.) is silently skipped.
///
/// Runs on a blocking thread because both Parakeet and llama.cpp loads do
/// substantial synchronous I/O.
pub fn prewarm(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();

        let (speech_model, rewrite_provider, rewrite_model) = {
            let db = state.db.lock().unwrap();
            (
                settings::get(&db, "speech_model").unwrap_or_default(),
                settings::get(&db, "rewrite_provider").unwrap_or_default(),
                settings::get(&db, "rewrite_model").unwrap_or_default(),
            )
        };

        if let Some(spec) = parakeet_spec_for(&speech_model) {
            let started = Instant::now();
            match ensure_parakeet_engine(&app, &state, spec) {
                Ok(_) => log::info!(
                    "Pre-warmed Parakeet `{}` in {:.2}s",
                    spec.id,
                    started.elapsed().as_secs_f64()
                ),
                Err(e) => log::info!("Parakeet pre-warm skipped: {}", e),
            }
        }

        // Apple FM's "model" is OS-resident — nothing to load on our end.
        // Other rewrite providers are network-only and need no pre-warm. The
        // legacy "Local" llama.cpp path is intentionally not pre-warmed; that
        // catalog was removed and stale settings are migrated by schema.rs.
        let _ = rewrite_provider;
        let _ = rewrite_model;
    });
}

fn ensure_parakeet_engine(
    app: &AppHandle,
    state: &AppState,
    spec: &crate::transcribe::local::download::LocalModelSpec,
) -> AppResult<Arc<ParakeetEngine>> {
    {
        let guard = state.parakeet_engine.lock().unwrap();
        if let Some((cached_id, engine)) = guard.as_ref() {
            if cached_id == spec.id {
                return Ok(Arc::clone(engine));
            }
        }
    }

    let model_dir = processing_mode::parakeet_spec_dir(app, spec).ok_or_else(|| {
        AppError::Config(
            "Could not resolve app data dir for Parakeet model. Reinstall the app.".into(),
        )
    })?;

    let load_started = Instant::now();
    let engine = ParakeetEngine::load(&ParakeetModelPaths::new(model_dir))?;
    log::info!(
        "Loaded Parakeet model `{}` in {:.2}s",
        spec.id,
        load_started.elapsed().as_secs_f64()
    );
    let engine = Arc::new(engine);

    let mut guard = state.parakeet_engine.lock().unwrap();
    *guard = Some((spec.id.to_string(), Arc::clone(&engine)));
    Ok(engine)
}

/// Remove one level of matched wrapping quotes from a rewrite output. Covers
/// straight ASCII quotes plus the common curly/CJK pairs. Single-pair wraps
/// are nearly always a model artifact; if the rewritten text starts and ends
/// with the same quote character we drop them.
/// Return true if `s` looks like a "the model had nothing to do" response
/// rather than an actual cleaned transcript. Small instruct models sometimes
/// emit these phrases despite the system prompt telling them not to. When
/// detected, the pipeline treats the rewrite as empty — placeholder gets
/// removed, nothing pasted.
fn is_no_change_sentinel(s: &str) -> bool {
    let normalized: String = s
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    matches!(
        normalized.as_str(),
        ""
            | "no change"
            | "no changes"
            | "no changes needed"
            | "no change needed"
            | "unchanged"
            | "no rewrite"
            | "no rewrite needed"
            | "nothing to change"
            | "nothing to clean"
            | "n a"
            | "na"
            | "none"
    )
}

fn strip_wrapping_quotes(s: &str) -> String {
    let trimmed = s.trim();
    let mut chars: Vec<char> = trimmed.chars().collect();
    if chars.len() < 2 {
        return trimmed.to_string();
    }
    let first = chars[0];
    let last = *chars.last().unwrap();
    let is_pair = matches!(
        (first, last),
        ('"', '"')
            | ('\'', '\'')
            | ('\u{201C}', '\u{201D}')
            | ('\u{2018}', '\u{2019}')
            | ('\u{300C}', '\u{300D}')
            | ('\u{300E}', '\u{300F}')
            | ('\u{00AB}', '\u{00BB}')
    );
    if !is_pair {
        return trimmed.to_string();
    }
    chars.remove(0);
    chars.pop();
    chars.iter().collect::<String>().trim().to_string()
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

/// Process audio for transcription: apply a soft noise gate and peak
/// normalization. Silence trimming (formerly Step 3) is disabled — see
/// the comment in place. The noise gate is kept; it suppresses room
/// noise without affecting speech.
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

    // Step 2: Apply soft noise gate — attenuate samples below threshold.
    // We don't hard-cut to avoid artifacts; 0.1× preserves enough signal
    // for Whisper to model the noise floor while suppressing AC hum / fan
    // noise / room tone.
    for sample in audio.iter_mut() {
        let abs = sample.abs();
        if abs < noise_gate_threshold {
            *sample *= 0.1;
        }
    }

    // Step 3 (disabled): we used to trim leading and trailing silence based
    // on a per-chunk RMS gate. That logic was too aggressive — it would
    // false-positive on quiet trailing speech (typical with AirPods, which
    // produce overall quiet audio that needs the 10× gain step below) and
    // drop seconds of real dictation. Symptom in the wild: 31s recording
    // → 6 words transcribed.
    //
    // Whisper and other modern STT models tolerate leading/trailing silence
    // natively, and at Groq Whisper Turbo prices ($0.04/hr → $0.0007/min)
    // the cost of sending a few extra silent seconds is negligible. So we
    // skip the trim entirely; the noise gate above and the peak normalize
    // below still help SNR without risking lost speech.

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

/// After a successful paste, subscribe to AX value-changed notifications
/// on the focused text element. The OS fires our callback the moment the
/// user edits the text in the destination app — typically <100 ms after
/// the keystroke — and we emit a `dictation-edited` event for the
/// frontend's vocab-prompt overlay.
///
/// Lifetime: the `ValueChangeObserver` returned by
/// `ax::subscribe_to_focused_value_changes` lives inside a tokio task that
/// holds it for `MONITOR_WINDOW`, then drops it (which removes the
/// notification + run-loop source + releases the AX objects). We don't
/// drop earlier on first-fire because the `fired` atomic guards against
/// duplicate events at near-zero cost — and keeping the observer alive
/// means a slow second edit within the window still gets a chance.
#[cfg(target_os = "macos")]
fn spawn_edit_monitor(app: tauri::AppHandle, state: &AppState, pasted: String) {
    use std::time::Duration;
    use serde_json::json;
    use tauri::Emitter;

    // How long the observer stays subscribed. After this we tear down so
    // we're not holding a permanent reference to a stale focused element.
    const MONITOR_WINDOW: Duration = Duration::from_secs(60);

    // Honor the user's preference up front. Reading once is enough — flipping
    // the toggle mid-monitor wouldn't make sense (the monitor is scoped to a
    // single paste). Default ON: the schema seeds 'true' for new installs.
    let auto_add_on = {
        let db = state.db.lock().unwrap();
        crate::db::settings::get(&db, "auto_add_vocabulary")
            .map(|v| v != "false")
            .unwrap_or(true)
    };
    if !auto_add_on {
        log::info!("Edit monitor: auto_add_vocabulary is off, skipping");
        return;
    }

    // Skip when the paste itself was tiny — nothing meaningful to learn,
    // and short pastes (e.g. "yes") are noisy false-positive triggers when
    // the focused field also has lots of other text.
    if pasted.chars().count() < 8 {
        log::info!(
            "Edit monitor: paste too short ({} chars < 8), skipping",
            pasted.chars().count()
        );
        return;
    }
    log::info!(
        "Edit monitor: spawning for {}-char paste",
        pasted.chars().count()
    );

    // The monitor only fires when the user *sends* — i.e. the focused
    // field's value drops to a small fraction of the post-paste baseline,
    // which is how chat apps (Slack, Messages, iMessage, Discord, etc.)
    // signal "message sent / input cleared". Non-chat surfaces (Notes,
    // docs, email composers) never clear, so this feature is a no-op for
    // those — that's intentional: the user explicitly asked for "only on
    // clear" so we don't pop a prompt while they're still typing.
    const CLEAR_THRESHOLD_RATIO: f64 = 0.2;

    let app_for_setup = app.clone();
    tauri::async_runtime::spawn(async move {
        // 250 ms = paste settle. Without this we capture an in-progress
        // baseline and fire on the paste's own value-changed notification.
        tokio::time::sleep(Duration::from_millis(250)).await;

        let baseline = match crate::ax::read_focused_text() {
            Some(text) => text,
            None => {
                log::info!("Edit monitor: focused element has no AX text; skipping");
                return;
            }
        };

        // Sanity check: the post-paste baseline should be in the same
        // ballpark as our paste. We used to require a strict
        // `contains(&pasted)` substring match, but macOS input-method
        // transforms (smart quotes, autocorrect, capitalization) often
        // mangle the typed text in flight — the baseline IS our paste,
        // just with a few characters changed. A length-based bound
        // (between paste/2 and paste*5) is enough to catch the truly
        // wrong-element case (tiny search bar / huge document) while
        // tolerating the input-method massaging.
        let pasted_len = pasted.chars().count();
        let baseline_len = baseline.chars().count();
        let lo = pasted_len / 2;
        let hi = pasted_len.saturating_mul(5);
        if baseline_len < lo || baseline_len > hi {
            log::info!(
                "Edit monitor: baseline length {} out of range [{}, {}] for paste {} chars; skipping (probably wrong element)",
                baseline_len, lo, hi, pasted_len
            );
            return;
        }
        log::info!(
            "Edit monitor: baseline captured ({} chars; paste was {} chars)",
            baseline_len, pasted_len
        );

        // Channel that hauls AX value samples onto our tokio task. The
        // detection loop below consumes from this; producers are:
        //   (a) the AX value-changed subscription (callbacks on main
        //       thread, instant when supported), and
        //   (b) a 250 ms polling task as a fallback for apps that don't
        //       fire `AXValueChanged` — most notably Electron apps like
        //       Slack, Discord, Lark, VS Code. They expose `AXValue` for
        //       reads but don't notify on change.
        // Both producers feed the same loop, so detection is whichever
        // gets there first. Polling is cheap (sub-ms per read).
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let tx_for_observer = tx.clone();
        let observer = crate::ax::subscribe_to_focused_value_changes(move |current| {
            let _ = tx_for_observer.send(current);
        });
        let Some(observer) = observer else {
            log::info!("Edit monitor: AX subscription unavailable (no focused element, or app blocks AX)");
            return;
        };
        // Wrap the observer in an Arc so the poll task can hold a ref
        // alongside the outer scope. The element-read in `read_current_text`
        // is AX-thread-safe.
        let observer = std::sync::Arc::new(observer);
        let observer_for_poll = std::sync::Arc::clone(&observer);

        // Watch for Return / Enter presses globally — the most reliable
        // "send" signal across all chat apps (Slack, Lark, iMessage, etc.)
        // regardless of how they manipulate their AX tree on submit.
        // Skipped if Shift is held (newline, not send) — see send_key.rs.
        let tx_for_enter = tx.clone();
        let observer_for_enter = std::sync::Arc::clone(&observer);
        let _enter_monitor = crate::hotkey::send_key::SendKeyMonitor::new(move || {
            // Snapshot the bound element's current text BEFORE pushing
            // the synthesized clear — this gives the detection loop one
            // final chance to update `latest` with anything typed in the
            // last <250 ms that polling hasn't observed yet.
            if let Some(current) = observer_for_enter.read_current_text() {
                let _ = tx_for_enter.send(current);
            }
            // Synthesize an empty value so the loop's clear-detection
            // fires with the just-updated `latest` as the emitted edit.
            let _ = tx_for_enter.send(String::new());
        });

        let tx_for_poll = tx;
        let poll_handle = tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(250));
            ticker.tick().await; // discard the immediate initial tick
            // Track whether previous reads succeeded so we can tell the
            // difference between "AX never gave us text" (silently ignore)
            // and "element used to expose text but stopped" (likely the
            // composer was destroyed and replaced — the chat-app pattern
            // for send-and-replace). The latter is a strong "sent" signal.
            let mut ever_read_some = false;
            let mut none_reads_in_a_row: u32 = 0;
            loop {
                ticker.tick().await;
                // Read the SAME element we subscribed to, not the system-
                // wide focused one — chat apps move focus away from the
                // composer when the user hits Send, so polling whatever
                // happens to be focused would land us on the message list
                // and miss the actual clear.
                match observer_for_poll.read_current_text() {
                    Some(current) => {
                        ever_read_some = true;
                        none_reads_in_a_row = 0;
                        if tx_for_poll.send(current).is_err() {
                            // Receiver dropped (loop exited).
                            break;
                        }
                    }
                    None => {
                        // If we previously read text and now don't, the
                        // element was likely destroyed (Lark and similar
                        // Electron chat apps replace the composer's DOM
                        // subtree on send). Treat sustained None as a
                        // clear and synthesize a zero-length sample so
                        // the detection loop fires.
                        if ever_read_some {
                            none_reads_in_a_row += 1;
                            if none_reads_in_a_row == 1 {
                                log::info!(
                                    "Edit monitor: poll read returned None after previous Some — element may have been destroyed (sent?)"
                                );
                            }
                            // Two consecutive None reads → confident the
                            // element is gone. Single None could be a
                            // transient AX hiccup.
                            if none_reads_in_a_row >= 2 {
                                let _ = tx_for_poll.send(String::new());
                                break;
                            }
                        }
                    }
                }
            }
        });

        let baseline_len = baseline.chars().count();
        let clear_threshold =
            ((baseline_len as f64) * CLEAR_THRESHOLD_RATIO).ceil() as usize;
        let mut latest = baseline.clone();

        // Wrap the whole channel loop in a hard ceiling — after this much
        // wall time we drop the observer regardless, to avoid holding
        // refs to a stale focused element forever. The loop itself only
        // exits early on clear/send detection.
        let clear_detected = tokio::time::timeout(MONITOR_WINDOW, async {
            let mut last_logged_len: Option<usize> = None;
            while let Some(current) = rx.recv().await {
                let current_len = current.chars().count();
                // Length-ratio sanity bound — if the value swung to
                // something wildly off (different element, etc.), drop
                // the sample but keep listening.
                let ratio = current_len as f64 / (baseline_len.max(1) as f64);
                if ratio > 2.5 {
                    continue;
                }

                // Trace every length transition so we can see in the log
                // whether the focused element's text is actually being
                // observed to change.
                if last_logged_len != Some(current_len) {
                    log::info!(
                        "Edit monitor: observed {} chars (baseline {}, clear threshold {})",
                        current_len, baseline_len, clear_threshold
                    );
                    last_logged_len = Some(current_len);
                }

                // Send detection — two complementary patterns:
                //   1. Field clears to ≤20% of baseline. Native chat apps
                //      (Messages, iMessage, Apple Mail Compose) and most
                //      web forms.
                //   2. Field's content suddenly jumps to a length far
                //      from what the user was typing toward (positive or
                //      negative ≥ baseline/2). This catches Lark and
                //      other Electron-style chat apps where send doesn't
                //      empty the composer — it *replaces* its content
                //      with something else (rendered preview, draft
                //      template, etc.). Gradual typing never trips this
                //      because the per-poll change is 1-3 chars.
                // Both gates require an actual edit before the trigger
                // (latest != baseline) so cmd-A-with-no-typing doesn't
                // false-fire, and a non-trivial baseline (≥8 chars) so
                // short pastes don't surface noise.
                let latest_len = latest.chars().count() as isize;
                let jump_threshold = (baseline_len / 2).max(20) as isize;
                let len_change = (current_len as isize - latest_len).abs();

                let is_clear = current_len <= clear_threshold
                    && latest != baseline
                    && baseline_len >= 8;
                let is_jump_replace = len_change >= jump_threshold
                    && latest != baseline
                    && baseline_len >= 8;

                if is_clear || is_jump_replace {
                    log::info!(
                        "Edit monitor: send detected (reason={}, baseline={} chars, current={} chars, latest_edit={} chars), emitting",
                        if is_clear { "clear" } else { "jump-replace" },
                        baseline_len,
                        current_len,
                        latest_len,
                    );
                    return Some(latest.clone());
                }
                if current != latest {
                    latest = current;
                }
            }
            None
        })
        .await
        .ok()
        .flatten();

        if let Some(final_text) = clear_detected {
            // We only ever reach this branch when the loop detected a real
            // clear/send with a prior edit, so we always emit here.
            let _ = app_for_setup.emit(
                "dictation-edited",
                json!({ "pasted": baseline, "edited": final_text }),
            );
        } else {
            log::info!(
                "Edit monitor: no clear detected within {} s window, no prompt",
                MONITOR_WINDOW.as_secs()
            );
        }
        poll_handle.abort();
        drop(observer);
    });
    // Suppress unused-variable warning on the borrowed `state`.
    let _ = state;
}

