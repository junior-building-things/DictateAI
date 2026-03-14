use tauri::{AppHandle, Emitter, Manager};

const OVERLAY_WIDTH: f64 = 260.0;
const OVERLAY_HEIGHT: f64 = 72.0;

/// Show the overlay window with the given state ("listening" or "rewriting")
pub fn show(app: &AppHandle, state: &str) {
    let _ = app.emit_to("overlay", "overlay-state", state);

    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.set_shadow(false);
        // Position near bottom-center of screen
        if let Ok(monitor) = window.current_monitor() {
            if let Some(monitor) = monitor {
                let screen_size = monitor.size();
                let scale = monitor.scale_factor();
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    OVERLAY_WIDTH,
                    OVERLAY_HEIGHT,
                )));
                let x = (screen_size.width as f64 / scale - OVERLAY_WIDTH) / 2.0;
                let y = screen_size.height as f64 / scale - OVERLAY_HEIGHT - 88.0;
                let _ = window
                    .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
            }
        }
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.show();
    }
}

/// Hide the overlay window
pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}
