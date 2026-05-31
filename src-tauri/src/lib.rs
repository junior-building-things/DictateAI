mod audio;
#[cfg(target_os = "macos")]
mod ax;
mod commands;
mod db;
mod error;
mod hotkey;
mod overlay;
mod paste;
mod pipeline;
mod pricing;
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

/// Sentinel string the frontend writes to the `hotkey` setting when the user
/// picks "Right Option" — a modifier-only binding that the standard
/// `RegisterEventHotKey` API doesn't accept. Matched on both startup
/// registration and the `update_hotkey` command.
pub const RIGHT_OPTION_SENTINEL: &str = "Right Option";

/// Auto-deletion horizon for non-starred history entries. Rows older than
/// this on app launch get pruned; starred rows are kept indefinitely.
/// Backs the public privacy claim ("auto-deleted after 30 days unless
/// starred") so change this only in concert with the marketing copy.
pub const HISTORY_RETENTION_DAYS: u32 = 30;

fn is_right_option_sentinel(value: &str) -> bool {
    value.eq_ignore_ascii_case(RIGHT_OPTION_SENTINEL)
}

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
                                        hotkey::handler::finalize_recording(
                                            app_clone, audio_data,
                                        )
                                        .await;
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
                                    hotkey::handler::finalize_recording(
                                        app_clone, audio_data,
                                    )
                                    .await;
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

            // Move any API keys still stored plaintext in the settings table
            // into the macOS Keychain. Idempotent — only does work if there
            // are leftovers from older versions.
            if let Err(e) = settings::migrate_secrets_to_keychain(&conn) {
                log::warn!("Secret migration to Keychain failed (non-fatal): {}", e);
            }

            // Auto-prune: drop history rows older than 30 days that aren't
            // starred. Backs the privacy claim that "dictations are stored
            // locally and auto-deleted after 30 days unless starred."
            // Runs once at startup — sufficient for daily-use apps; for
            // very long sessions, a background interval would be the
            // belt-and-suspenders option.
            match crate::db::history::prune_unstarred_older_than(&conn, HISTORY_RETENTION_DAYS) {
                Ok(0) => {}
                Ok(n) => log::info!(
                    "Pruned {} history rows older than {} days (unstarred)",
                    n, HISTORY_RETENTION_DAYS
                ),
                Err(e) => log::warn!("History auto-prune failed (non-fatal): {}", e),
            }

            // Create app state
            let app_state = AppState::new(conn);
            app.manage(app_state);

            let handle = app.handle().clone();

            // Setup hotkey state
            let hotkey_state = HotkeyState::new().expect("Failed to create hotkey state");
            app.manage(hotkey_state);

            // Shared "next term to display in the overlay's vocab-prompt
            // mode" bucket — see `overlay::PendingVocabTerm` for the why.
            app.manage(overlay::PendingVocabTerm::default());

            // Right-Option monitor is managed even when not currently in
            // use — `update_hotkey` can start it at runtime if the user
            // switches to "Right Option" later. macOS only.
            #[cfg(target_os = "macos")]
            {
                app.manage(hotkey::right_option::RightOptionMonitor::new());
            }

            // Read configured hotkey. Special sentinel "Right Option" picks
            // the NSEvent-based monitor path; anything else goes through
            // the standard global-shortcut plugin.
            let hotkey_str = {
                let st = handle.state::<AppState>();
                let db = st.db.lock().unwrap();
                settings::get(&db, "hotkey").unwrap_or_else(|_| "CommandOrControl+S".into())
            };

            if is_right_option_sentinel(&hotkey_str) {
                #[cfg(target_os = "macos")]
                {
                    app.state::<hotkey::right_option::RightOptionMonitor>()
                        .start(handle.clone());
                }
                #[cfg(not(target_os = "macos"))]
                {
                    log::warn!(
                        "'Right Option' hotkey is macOS-only; falling back to default."
                    );
                    let shortcut: Shortcut = "CommandOrControl+S".parse().unwrap();
                    app.global_shortcut().register(shortcut)?;
                }
            } else {
                let shortcut: Shortcut = hotkey_str
                    .parse()
                    .unwrap_or_else(|_| "CommandOrControl+S".parse().unwrap());
                app.global_shortcut().register(shortcut)?;
            }

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

            // Pre-warm any local engines the user has selected so the first
            // dictation doesn't pay model-load latency. Background task —
            // app keeps starting normally if this is slow.
            pipeline::prewarm(handle.clone());

            // Overlay window must be declared `visible: true` in
            // tauri.conf.json — on this Tauri 2 + macOS combo, a
            // `visible: false` window never attaches its WKWebView, so
            // React never mounts, `take_pending_vocab_term` is never
            // called, and the pill never renders no matter how many
            // `window.show()` calls we make. (Confirmed via three
            // separate diagnostic passes: magenta-CSS test, main-thread
            // dispatch test, and a definitive log showing show()
            // returning Ok but no React mount.)
            //
            // To keep the window invisible to the user when not
            // actively prompting, we park it WAY off-screen here. The
            // OS thinks it's always shown, the WKWebView stays
            // attached, React mounts, the `overlay-state` listener
            // stays registered. `overlay::show_vocab` just teleports
            // the window on-screen; `overlay::hide` teleports it back
            // off-screen.
            if let Some(overlay_win) = app.get_webview_window("overlay") {
                overlay::park_offscreen(&overlay_win);
                #[cfg(target_os = "macos")]
                overlay::apply_fullscreen_overlay_behavior_public(&overlay_win);
                log::info!("overlay: parked off-screen + NSPanel behavior applied");
            } else {
                log::warn!("overlay: window 'overlay' not found at startup");
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
            commands::generate_phonetic,
            commands::show_vocab_prompt,
            commands::hide_vocab_prompt,
            commands::take_pending_vocab_term,
            commands::frontend_ping,
            commands::get_available_models,
            commands::local_model_status,
            commands::download_local_model,
            commands::delete_local_model,
            commands::apple_fm_availability,
            commands::validate_gemini_api_key,
            commands::validate_openai_api_key,
            commands::validate_deepgram_api_key,
            commands::validate_google_speech_config,
            commands::validate_nvidia_config,
            commands::validate_alibaba_api_key,
            commands::validate_groq_api_key,
            commands::get_app_state,
            commands::processing_mode_status,
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
