use tauri::{AppHandle, Emitter, Manager};

/// Show the overlay window with the given state ("listening" or "rewriting")
pub fn show(app: &AppHandle, state: &str) {
    let _ = app.emit_to("overlay", "overlay-state", state);

    if let Some(window) = app.get_webview_window("overlay") {
        // Position near bottom-center of screen
        if let Ok(monitor) = window.current_monitor() {
            if let Some(monitor) = monitor {
                let screen_size = monitor.size();
                let scale = monitor.scale_factor();
                let win_width = 200.0;
                let win_height = 50.0;
                let x = (screen_size.width as f64 / scale - win_width) / 2.0;
                let y = screen_size.height as f64 / scale - win_height - 88.0;
                let _ = window.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition::new(x, y),
                ));
            }
        }
        // Only allow interaction while rewriting so the cancel button can be clicked.
        let _ = window.set_ignore_cursor_events(state == "listening");
        let _ = window.show();
    }
}

/// Hide the overlay window
pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}
