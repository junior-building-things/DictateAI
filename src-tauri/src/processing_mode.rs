use tauri::AppHandle;

use crate::db::settings;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeResolution;

pub fn resolve(app: &AppHandle, state: &AppState) -> Option<ModeResolution> {
    let (
        speech_model,
        deepgram_api_key,
        google_api_key,
        google_project_id,
        alibaba_api_key,
        openai_api_key,
        doubao_access_token,
        doubao_app_id,
    ) = {
        let db = state.db.lock().unwrap();
        (
            settings::get(&db, "speech_model")
                .unwrap_or_else(|_| "gpt-4o-mini-transcribe".to_string()),
            settings::get(&db, "speech_deepgram_api_key").unwrap_or_default(),
            settings::get(&db, "speech_google_api_key").unwrap_or_default(),
            settings::get(&db, "speech_google_project_id").unwrap_or_default(),
            settings::get(&db, "alibaba_api_key").unwrap_or_default(),
            settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
            settings::get(&db, "speech_doubao_access_token").unwrap_or_default(),
            settings::get(&db, "speech_doubao_app_id").unwrap_or_default(),
        )
    };

    let api_ready = match speech_model.as_str() {
        "nova-3" => !deepgram_api_key.trim().is_empty(),
        "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" => !openai_api_key.trim().is_empty(),
        "chirp_3" => {
            !google_api_key.trim().is_empty() && !google_project_id.trim().is_empty()
        }
        "qwen3-asr-flash" => !alibaba_api_key.trim().is_empty(),
        "doubao-byteplus" => {
            !doubao_access_token.trim().is_empty() && !doubao_app_id.trim().is_empty()
        }
        _ => false,
    };
    let _ = app;

    api_ready.then_some(ModeResolution)
}
