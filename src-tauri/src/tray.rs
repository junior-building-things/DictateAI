use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::error::AppResult;

pub fn setup(app: &AppHandle) -> AppResult<()> {
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)
        .map_err(|e| {
            crate::error::AppError::Config(format!("Failed to create menu item: {}", e))
        })?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| {
        crate::error::AppError::Config(format!("Failed to create menu item: {}", e))
    })?;

    let menu = Menu::with_items(app, &[&settings_item, &quit_item])
        .map_err(|e| crate::error::AppError::Config(format!("Failed to create menu: {}", e)))?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("DictateAI")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| crate::error::AppError::Config(format!("Failed to build tray: {}", e)))?;

    Ok(())
}
