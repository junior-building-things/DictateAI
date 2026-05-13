use tauri::{AppHandle, Manager};

use crate::db::settings;
use crate::state::AppState;
use crate::transcribe::local::download::{model_dir, parakeet_spec_for, LocalModelSpec};
use crate::transcribe::local::parakeet::ParakeetModelPaths;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeResolution;

/// Resolve the currently-selected Parakeet spec, if any. Returns `None` when
/// the user is on a non-Parakeet speech model.
pub fn selected_parakeet_spec(state: &AppState) -> Option<&'static LocalModelSpec> {
    let speech_model = {
        let db = state.db.lock().unwrap();
        settings::get(&db, "speech_model").unwrap_or_default()
    };
    parakeet_spec_for(&speech_model)
}

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

    let ready = match speech_model.as_str() {
        "nova-3" => !deepgram_api_key.trim().is_empty(),
        "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" => !openai_api_key.trim().is_empty(),
        "chirp_3" => !google_api_key.trim().is_empty() && !google_project_id.trim().is_empty(),
        "qwen3-asr-flash" => !alibaba_api_key.trim().is_empty(),
        "doubao-byteplus" => {
            !doubao_access_token.trim().is_empty() && !doubao_app_id.trim().is_empty()
        }
        other => parakeet_spec_for(other)
            .map(|spec| parakeet_spec_ready(app, spec))
            .unwrap_or(false),
    };

    ready.then_some(ModeResolution)
}

/// True when the requested Parakeet spec's model files are present on disk.
pub fn parakeet_spec_ready(app: &AppHandle, spec: &LocalModelSpec) -> bool {
    let Some(dir) = parakeet_spec_dir(app, spec) else {
        return false;
    };
    ParakeetModelPaths::new(dir).is_complete()
}

pub fn parakeet_spec_dir(
    app: &AppHandle,
    spec: &LocalModelSpec,
) -> Option<std::path::PathBuf> {
    let app_data_dir = app.path().app_data_dir().ok()?;
    Some(model_dir(&app_data_dir, spec))
}
