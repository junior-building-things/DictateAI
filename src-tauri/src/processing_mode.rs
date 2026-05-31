use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db::settings;
use crate::state::AppState;
use crate::transcribe::local::download::{model_dir, parakeet_spec_for, LocalModelSpec};
use crate::transcribe::local::parakeet::ParakeetModelPaths;

/// Snapshot of whether the currently-selected speech and rewrite providers
/// have everything they need to run a dictation end-to-end. Surfaced to
/// the Dashboard so it can swap the "Tap/Hold ⌘A to dictate." headline
/// for "Configure speech/rewrite model to start dictating." when one of
/// the halves is missing a key or local model. Camel-cased on the wire to
/// match the rest of the JS API.
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingModeStatus {
    pub speech_ready: bool,
    pub rewrite_ready: bool,
}

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
        groq_api_key,
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
            settings::get(&db, "speech_groq_api_key").unwrap_or_default(),
            settings::get(&db, "speech_doubao_access_token").unwrap_or_default(),
            settings::get(&db, "speech_doubao_app_id").unwrap_or_default(),
        )
    };

    let ready = match speech_model.as_str() {
        "nova-3" => !deepgram_api_key.trim().is_empty(),
        "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" => !openai_api_key.trim().is_empty(),
        "whisper-large-v3" | "whisper-large-v3-turbo" => !groq_api_key.trim().is_empty(),
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

/// Whether the currently-selected rewrite provider has the credential /
/// availability it needs to run. Apple FM is treated as always-ready here
/// (we let it fall back at run-time if the helper isn't built or the OS
/// model is downloading) — the Dashboard's intent is "the user has to do
/// something in Settings", and there's nothing the user can configure for
/// Apple FM from Settings other than picking it.
fn rewrite_ready(state: &AppState) -> bool {
    let (provider, openai_key, gemini_key, groq_key, alibaba_key) = {
        let db = state.db.lock().unwrap();
        (
            settings::get(&db, "rewrite_provider").unwrap_or_default(),
            settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
            settings::get(&db, "gemini_api_key").unwrap_or_default(),
            settings::get(&db, "groq_api_key").unwrap_or_default(),
            settings::get(&db, "alibaba_api_key").unwrap_or_default(),
        )
    };
    match provider.as_str() {
        "OpenAI" => !openai_key.trim().is_empty(),
        "Google" => !gemini_key.trim().is_empty(),
        "Groq" => !groq_key.trim().is_empty(),
        "Alibaba" => !alibaba_key.trim().is_empty(),
        // Apple FM and the legacy "Local" path — assume ready; the pipeline
        // already falls back to raw text if Apple FM can't run, so the
        // Dashboard doesn't need to gate the hero on Apple-FM availability.
        _ => true,
    }
}

/// Combined status snapshot for the Dashboard.
pub fn status(app: &AppHandle, state: &AppState) -> ProcessingModeStatus {
    ProcessingModeStatus {
        speech_ready: resolve(app, state).is_some(),
        rewrite_ready: rewrite_ready(state),
    }
}
