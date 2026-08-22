use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::{history, settings, vocabulary};
use crate::hotkey::handler::HotkeyState;
use crate::processing_mode;
use crate::rewrite::alibaba;
#[cfg(target_os = "macos")]
use crate::rewrite::apple_fm;
use crate::rewrite::gemini;
use crate::rewrite::groq;
use crate::rewrite::openai as openai_rewrite;
use crate::rewrite::prompt;
use crate::state::{AppState, STATE_IDLE};
use crate::transcribe::api;
use crate::transcribe::local::download::{
    self as local_download, direct_file_path, find_model, LocalArtifact,
};
use crate::transcribe::model_manager;

// --- Settings ---

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Vec<(String, String)>, String> {
    let db = state.db.lock().unwrap();
    settings::get_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    settings::get(&db, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    settings::set(&db, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_hotkey(app: AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
    // Always tear down whichever path is currently active before swapping —
    // otherwise stale registrations stick around and fight the new one.
    let _ = app.global_shortcut().unregister_all();
    #[cfg(target_os = "macos")]
    {
        app.state::<crate::hotkey::right_option::RightOptionMonitor>()
            .stop();
    }

    // Special sentinel: bare right-Option — goes through the NSEvent
    // monitor, not the global-shortcut plugin (which rejects modifier-only
    // bindings on macOS).
    if hotkey.eq_ignore_ascii_case(crate::RIGHT_OPTION_SENTINEL) {
        #[cfg(target_os = "macos")]
        {
            app.state::<crate::hotkey::right_option::RightOptionMonitor>()
                .start(app.clone());
            let db = state.db.lock().unwrap();
            return settings::set(&db, "hotkey", &hotkey).map_err(|e| e.to_string());
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("Right Option hotkey is macOS-only.".into());
        }
    }

    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("Invalid hotkey '{}': {}", hotkey, e))?;

    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("Failed to register new hotkey: {}", e))?;

    let db = state.db.lock().unwrap();
    settings::set(&db, "hotkey", &hotkey).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_system_prompt() -> String {
    prompt::default_system_instruction().to_string()
}

// --- History ---

#[tauri::command]
pub fn get_history(
    state: State<AppState>,
    page: usize,
    per_page: usize,
) -> Result<(Vec<history::HistoryEntry>, usize), String> {
    let db = state.db.lock().unwrap();
    history::get_page(&db, page, per_page).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_history_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    history::delete_entry(&db, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_history_entry(
    state: State<AppState>,
    id: i64,
    rewritten: String,
) -> Result<(), String> {
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err("Rewritten text cannot be empty.".into());
    }

    let db = state.db.lock().unwrap();
    history::update_rewritten_text(&db, id, trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_history_favorite(
    state: State<AppState>,
    id: i64,
    favorited: bool,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    history::update_favorite(&db, id, favorited).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    history::clear_all(&db).map_err(|e| e.to_string())
}

// --- Vocabulary ---

#[tauri::command]
pub fn get_vocabulary(state: State<AppState>) -> Result<Vec<vocabulary::VocabularyTerm>, String> {
    let db = state.db.lock().unwrap();
    vocabulary::get_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_vocabulary_term(
    state: State<AppState>,
    term: String,
    phonetic: Option<String>,
    definition: Option<String>,
    category: String,
) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    vocabulary::add_term(
        &db,
        &term,
        phonetic.as_deref(),
        definition.as_deref(),
        &category,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_vocabulary_term(
    state: State<AppState>,
    id: i64,
    term: String,
    phonetic: Option<String>,
    definition: Option<String>,
    category: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    vocabulary::update_term(
        &db,
        id,
        &term,
        phonetic.as_deref(),
        definition.as_deref(),
        &category,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_vocabulary_term(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    vocabulary::delete_term(&db, id).map_err(|e| e.to_string())
}

// --- Model Management ---

#[tauri::command]
pub fn get_available_models(state: State<AppState>) -> Vec<model_manager::ModelInfo> {
    let db = state.db.lock().unwrap();
    let language = settings::get(&db, "language").unwrap_or_else(|_| "en".into());
    model_manager::available_models(&language)
}

// --- Local STT models ---

#[derive(serde::Serialize)]
pub struct LocalModelStatus {
    pub id: String,
    pub installed: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub fn local_model_status(app: AppHandle, model_id: String) -> Result<LocalModelStatus, String> {
    let spec = find_model(&model_id).ok_or_else(|| format!("Unknown model id: {}", model_id))?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    let dir = local_download::model_dir(&app_data_dir, spec);
    let (installed, reported_path) = match &spec.artifact {
        LocalArtifact::TarBz2 { .. } => {
            let installed =
                crate::transcribe::local::parakeet::ParakeetModelPaths::new(dir.clone())
                    .is_complete();
            (installed, installed.then(|| dir.clone()))
        }
        LocalArtifact::DirectFile { .. } => {
            let path = direct_file_path(&app_data_dir, spec);
            let installed = path.as_ref().map(|p| p.exists()).unwrap_or(false);
            (installed, installed.then(|| path.unwrap()))
        }
    };
    Ok(LocalModelStatus {
        id: spec.id.into(),
        installed,
        path: reported_path.map(|p| p.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn download_local_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<String, String> {
    let spec = find_model(&model_id)
        .ok_or_else(|| format!("Unknown model id: {}", model_id))?
        .clone();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    let http = state.http_client.clone();
    let path = local_download::install_model(&app, &http, &app_data_dir, &spec)
        .await
        .map_err(|e| e.to_string())?;
    invalidate_engine_caches(&state, &spec.id);
    // Warm the freshly-installed model in the background so the first
    // dictation after install doesn't pay the cold-load cost.
    crate::pipeline::prewarm(app.clone());
    Ok(path.to_string_lossy().into_owned())
}

/// Probe Apple's Foundation Models framework. Returns one of:
///   "available"   — model ready to use
///   "unavailable" — helper exists but the OS says the model isn't ready
///                   (no Apple Intelligence, not eligible, etc.)
///   "not-built"   — helper wasn't compiled (no swiftc / pre-macOS-26)
///   "unsupported" — not running on macOS at all
#[tauri::command]
pub async fn apple_fm_availability() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use crate::rewrite::apple_fm::{check_availability, Availability};
        Ok(match check_availability().await {
            Availability::Available => "available",
            Availability::NotBuilt => "not-built",
            Availability::Unavailable => "unavailable",
        }
        .to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unsupported".to_string())
    }
}

#[tauri::command]
pub fn delete_local_model(
    app: AppHandle,
    state: State<AppState>,
    model_id: String,
) -> Result<(), String> {
    let spec = find_model(&model_id).ok_or_else(|| format!("Unknown model id: {}", model_id))?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir error: {}", e))?;
    let dir = local_download::model_dir(&app_data_dir, spec);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Delete model failed: {}", e))?;
    }
    invalidate_engine_caches(&state, &model_id);
    Ok(())
}

/// Drop cached engines whose backing file may have just changed on disk so the
/// next pipeline run reloads from the new bytes. Cheap: we don't know which
/// engine is which, so when in doubt we clear both.
fn invalidate_engine_caches(state: &AppState, model_id: &str) {
    if model_id.starts_with("parakeet") {
        let mut guard = state.parakeet_engine.lock().unwrap();
        *guard = None;
    } else if model_id.starts_with("llama") || model_id.starts_with("gemma") {
        let mut guard = state.local_llm.lock().unwrap();
        *guard = None;
    } else {
        let mut p = state.parakeet_engine.lock().unwrap();
        *p = None;
        let mut l = state.local_llm.lock().unwrap();
        *l = None;
    }
}

#[tauri::command]
pub async fn validate_gemini_api_key(
    state: State<'_, AppState>,
    api_key: String,
    model_name: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    gemini::validate_api_key(&client, &api_key, &model_name)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn validate_openai_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    api::validate_openai_api_key(&client, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn validate_deepgram_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    api::validate_deepgram_api_key(&client, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn validate_google_speech_config(
    state: State<'_, AppState>,
    api_key: String,
    project_id: String,
    region: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    api::validate_google_speech_config(&client, &api_key, &project_id, &region)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn validate_nvidia_config(
    state: State<'_, AppState>,
    base_url: String,
    api_key: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    api::validate_nvidia_config(&client, &base_url, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn validate_groq_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    groq::validate_api_key(&client, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn validate_alibaba_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> Result<bool, String> {
    let client = state.http_client.clone();
    alibaba::validate_api_key(
        &client,
        &api_key,
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "qwen2.5-7b-instruct",
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(true)
}

// --- App State ---

#[tauri::command]
pub fn get_app_state(state: State<AppState>) -> String {
    match state.get_state() {
        0 => "idle".to_string(),
        1 => "recording".to_string(),
        2 => "processing".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Snapshot of whether the currently-selected speech + rewrite providers
/// are configured (API keys present, local models downloaded, etc.). The
/// Dashboard uses this to decide between "Tap/Hold ⌘A to dictate." and
/// "Configure speech model to start dictating." headlines.
#[tauri::command]
pub fn processing_mode_status(
    app: AppHandle,
    state: State<AppState>,
) -> processing_mode::ProcessingModeStatus {
    processing_mode::status(&app, &state)
}

#[tauri::command]
pub fn cancel_processing(app: AppHandle, state: State<AppState>) {
    state.cancel_current_run();
    state.set_state(STATE_IDLE);
    let _ = app.emit("state-changed", "idle");
    // Clean up any 🎙️ / ✏️ placeholder left in the focused field.
    if let Some(len) = state.pending_placeholder.lock().unwrap().take() {
        if let Err(e) = crate::paste::simulate::delete_placeholder(len) {
            log::warn!("Could not delete recording placeholder: {}", e);
        }
    }
}

#[tauri::command]
pub fn start_manual_recording(
    app: AppHandle,
    hotkey_state: State<HotkeyState>,
    state: State<AppState>,
) -> Result<(), String> {
    if !state.is_idle() {
        return Err("Dictation is already active.".into());
    }

    let Some(_) = processing_mode::resolve(&app, &state) else {
        return Err(
            "No speech model is currently available. Configure a supported speech provider in Models."
                .into(),
        );
    };

    crate::hotkey::handler::on_pressed(&app, &hotkey_state, &state);

    if state.is_recording() {
        Ok(())
    } else {
        Err("Failed to start recording.".into())
    }
}

#[tauri::command]
pub fn stop_manual_recording(
    app: AppHandle,
    hotkey_state: State<HotkeyState>,
    state: State<AppState>,
) -> Result<(), String> {
    if !state.is_recording() {
        return Err("Dictation is not currently listening.".into());
    }

    if let Some(audio_data) = crate::hotkey::handler::on_released(&app, &hotkey_state, &state) {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::hotkey::handler::finalize_recording(app_clone, audio_data).await;
        });
    }

    Ok(())
}

// --- Accessibility ---

#[tauri::command]
pub fn check_accessibility() -> bool {
    crate::paste::simulate::check_accessibility()
}

#[tauri::command]
pub fn check_microphone_permission() -> String {
    crate::paste::simulate::check_microphone_permission()
}

#[tauri::command]
pub fn prompt_microphone_permission() {
    crate::paste::simulate::prompt_microphone_permission()
}

#[tauri::command]
pub fn prompt_accessibility_permission() {
    crate::paste::simulate::prompt_accessibility_permission()
}

// --- Vocabulary helpers ---

/// Ask the user's configured rewrite model to generate a simple ASCII-letter
/// phonetic pronunciation for a single term. Used by the History tab's
/// "learn from corrections" flow: when the user edits a misheard word back
/// to the correct form, the frontend prompts to add the new term to the
/// vocabulary and calls this command to fill in the Phonetic field so the
/// user doesn't have to type it.
///
/// Reuses whichever rewrite provider the user already has configured.
/// Errors propagate as strings — the caller falls back to a null phonetic
/// if generation fails (e.g., no API key for the selected provider).
#[tauri::command]
pub async fn generate_phonetic(
    state: State<'_, AppState>,
    term: String,
) -> Result<String, String> {
    let term = term.trim().to_string();
    if term.is_empty() {
        return Err("Empty term".into());
    }

    // Snapshot everything we need out of the DB before the await — holding
    // the MutexGuard across .await would make the future non-Send and
    // wouldn't satisfy tauri's command runtime.
    let (
        provider,
        model,
        openai_key,
        gemini_key,
        groq_key,
        alibaba_key,
        alibaba_base,
    ) = {
        let db = state.db.lock().unwrap();
        (
            settings::get(&db, "rewrite_provider").unwrap_or_default(),
            settings::get(&db, "rewrite_model").unwrap_or_default(),
            settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
            settings::get(&db, "gemini_api_key").unwrap_or_default(),
            settings::get(&db, "groq_api_key").unwrap_or_default(),
            settings::get(&db, "alibaba_api_key").unwrap_or_default(),
            settings::get(&db, "alibaba_base_url").unwrap_or_else(|_| {
                "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".into()
            }),
        )
    };
    let http = state.http_client.clone();

    let system = "You generate simple English-letter phonetic spellings for proper nouns and domain terms. \
Given a single word or token, reply with ONLY the phonetic, hyphenated by syllable, no quotes, no explanation. \
Examples:\n\
  Seedream -> SEE-dream\n\
  OAuth -> OH-auth\n\
  ByteDance -> BITE-dance\n\
  kubectl -> KOO-buh-cuhl\n\
  Aeolus -> A-less";
    let user = term.as_str();

    let outcome = match provider.as_str() {
        "OpenAI" => openai_rewrite::rewrite(&http, &openai_key, &model, system, user).await,
        // Phonetic generation is a single-token lookup, not the dictation
        // rewrite — pinned to `minimal` rather than the user's setting.
        "Google" => gemini::rewrite(&http, &gemini_key, &model, system, user, "minimal").await,
        "Groq" => groq::rewrite(&http, &groq_key, &model, system, user).await,
        "Alibaba" => {
            alibaba::rewrite(&http, &alibaba_key, &alibaba_base, &model, system, user).await
        }
        #[cfg(target_os = "macos")]
        "Apple" => apple_fm::rewrite(system, user).await,
        other => {
            return Err(format!(
                "Phonetic generation not available for rewrite provider '{}'",
                other
            ));
        }
    }
    .map_err(|e| e.to_string())?;

    // Trim whitespace + strip any stray surrounding quotes the model added
    // despite the prompt — small instruct models love wrapping output in "".
    let cleaned = outcome
        .text
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`')
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return Err("Model returned empty phonetic".into());
    }
    Ok(cleaned)
}
