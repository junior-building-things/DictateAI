use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::{history, settings, vocabulary};
use crate::hotkey::handler::HotkeyState;
use crate::processing_mode;
use crate::rewrite::alibaba;
use crate::rewrite::gemini;
use crate::rewrite::prompt;
use crate::state::{AppState, STATE_IDLE};
use crate::transcribe::api;
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
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("Invalid hotkey '{}': {}", hotkey, e))?;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("Failed to unregister existing hotkeys: {}", e))?;
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

#[tauri::command]
pub fn cancel_processing(app: AppHandle, state: State<AppState>) {
    state.cancel_current_run();
    state.set_state(STATE_IDLE);
    let _ = app.emit("state-changed", "idle");
    crate::overlay::hide(&app);
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
            if let Err(e) = crate::pipeline::run(app_clone, audio_data).await {
                log::error!("Pipeline failed: {}", e);
            }
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
