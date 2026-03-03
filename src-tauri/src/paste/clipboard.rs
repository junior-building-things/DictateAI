use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult};

pub fn write_text(app: &AppHandle, text: &str) -> AppResult<()> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| AppError::Clipboard(format!("Failed to write to clipboard: {}", e)))?;
    log::info!("Text written to clipboard ({} chars)", text.len());
    Ok(())
}
