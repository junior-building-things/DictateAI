use tauri::AppHandle;

use crate::db::settings;
use crate::on_device;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessingMode {
    Api,
    OnDevice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeResolution {
    pub mode: ProcessingMode,
    pub fell_back_from_on_device: bool,
}

pub fn resolve(app: &AppHandle, state: &AppState) -> Option<ModeResolution> {
    let (preferred_mode, openai_api_key) = {
        let db = state.db.lock().unwrap();
        (
            settings::get(&db, "model_mode").unwrap_or_else(|_| "api".to_string()),
            settings::get(&db, "speech_openai_api_key").unwrap_or_default(),
        )
    };

    let api_ready = !openai_api_key.trim().is_empty();
    let on_device_ready = match on_device::status(app) {
        Ok(status) => status.ready,
        Err(error) => {
            log::warn!("Failed to check on-device readiness: {}", error);
            false
        }
    };

    if preferred_mode == "on-device" {
        if on_device_ready {
            Some(ModeResolution {
                mode: ProcessingMode::OnDevice,
                fell_back_from_on_device: false,
            })
        } else if api_ready {
            Some(ModeResolution {
                mode: ProcessingMode::Api,
                fell_back_from_on_device: true,
            })
        } else {
            None
        }
    } else if api_ready {
        Some(ModeResolution {
            mode: ProcessingMode::Api,
            fell_back_from_on_device: false,
        })
    } else {
        None
    }
}
