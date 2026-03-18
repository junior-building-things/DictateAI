mod audio;
mod commands;
mod db;
mod error;
mod hotkey;
mod overlay;
mod paste;
mod pipeline;
mod processing_mode;
mod rewrite;
mod state;
mod transcribe;
mod tray;

use rusqlite::Connection;
use tauri::{LogicalPosition, LogicalSize, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::db::{schema, settings};
use crate::hotkey::handler::HotkeyState;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    let hotkey_state = app.state::<HotkeyState>();
                    let app_state = app.state::<AppState>();
                    let hotkey_mode = {
                        let db = app_state.db.lock().unwrap();
                        settings::get(&db, "hotkey_mode").unwrap_or_else(|_| "hold".into())
                    };

                    if hotkey_mode == "toggle" {
                        if event.state == ShortcutState::Pressed {
                            if app_state.is_recording() {
                                if let Some(audio_data) =
                                    hotkey::handler::on_released(app, &hotkey_state, &app_state)
                                {
                                    let app_clone = app.clone();
                                    tauri::async_runtime::spawn(async move {
                                        if let Err(e) = pipeline::run(app_clone, audio_data).await {
                                            log::error!("Pipeline failed: {}", e);
                                        }
                                    });
                                }
                            } else if app_state.is_idle() {
                                hotkey::handler::on_pressed(app, &hotkey_state, &app_state);
                            }
                        }
                        return;
                    }

                    match event.state {
                        ShortcutState::Pressed => {
                            hotkey::handler::on_pressed(app, &hotkey_state, &app_state);
                        }
                        ShortcutState::Released => {
                            if let Some(audio_data) =
                                hotkey::handler::on_released(app, &hotkey_state, &app_state)
                            {
                                let app_clone = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    if let Err(e) = pipeline::run(app_clone, audio_data).await {
                                        log::error!("Pipeline failed: {}", e);
                                    }
                                });
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize database
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("dictate-ai.db");
            let legacy_db_path = app_data_dir.join("ai-speech-to-text.db");
            if !db_path.exists() && legacy_db_path.exists() {
                match std::fs::rename(&legacy_db_path, &db_path) {
                    Ok(()) => {
                        log::info!(
                            "Migrated legacy database from {:?} to {:?}",
                            legacy_db_path,
                            db_path
                        );
                    }
                    Err(err) => {
                        log::warn!(
                            "Failed to migrate legacy database from {:?} to {:?}: {}",
                            legacy_db_path,
                            db_path,
                            err
                        );
                    }
                }
            }
            let conn = Connection::open(&db_path)?;
            schema::run_migrations(&conn)?;
            log::info!("Database initialized at {:?}", db_path);

            // Create app state
            let app_state = AppState::new(conn);
            app.manage(app_state);

            let handle = app.handle().clone();

            // Setup hotkey state
            let hotkey_state = HotkeyState::new().expect("Failed to create hotkey state");
            app.manage(hotkey_state);

            // Register global hotkey
            let hotkey_str = {
                let st = handle.state::<AppState>();
                let db = st.db.lock().unwrap();
                settings::get(&db, "hotkey").unwrap_or_else(|_| "CommandOrControl+S".into())
            };

            let shortcut: Shortcut = hotkey_str
                .parse()
                .unwrap_or_else(|_| "CommandOrControl+S".parse().unwrap());

            app.global_shortcut().register(shortcut)?;

            // Setup system tray
            tray::setup(app.handle())?;

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let scale = monitor.scale_factor();
                    let screen_size = monitor.size();
                    let logical_width = screen_size.width as f64 / scale;
                    let logical_height = screen_size.height as f64 / scale;
                    let window_width = 1000.0;
                    let window_height = (logical_height - 48.0).max(600.0);
                    let x = ((logical_width - window_width) / 2.0).max(0.0);

                    let _ = window.set_size(tauri::Size::Logical(LogicalSize::new(
                        window_width,
                        window_height,
                    )));
                    let _ = window
                        .set_position(tauri::Position::Logical(LogicalPosition::new(x, 24.0)));
                }
            }

            log::info!("App setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::get_setting,
            commands::save_setting,
            commands::update_hotkey,
            commands::get_default_system_prompt,
            commands::get_history,
            commands::delete_history_entry,
            commands::update_history_entry,
            commands::set_history_favorite,
            commands::clear_history,
            commands::get_vocabulary,
            commands::add_vocabulary_term,
            commands::update_vocabulary_term,
            commands::delete_vocabulary_term,
            commands::get_available_models,
            commands::validate_gemini_api_key,
            commands::validate_openai_api_key,
            commands::validate_deepgram_api_key,
            commands::validate_google_speech_config,
            commands::validate_nvidia_config,
            commands::validate_alibaba_api_key,
            commands::get_app_state,
            commands::cancel_processing,
            commands::start_manual_recording,
            commands::stop_manual_recording,
            commands::check_accessibility,
            commands::check_microphone_permission,
            commands::prompt_microphone_permission,
            commands::prompt_accessibility_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
