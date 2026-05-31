use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
extern "C" {
    fn object_setClass(
        obj: *mut objc::runtime::Object,
        cls: *const objc::runtime::Class,
    ) -> *const objc::runtime::Class;
}

/// Base width for the listening/rewriting pill. Vocab prompts get a wider
/// width (`VOCAB_OVERLAY_WIDTH`) at runtime to fit "Add 'Term' to
/// vocabulary?" + the Add button.
const OVERLAY_WIDTH: f64 = 220.0;
const OVERLAY_HEIGHT: f64 = 40.0;
const VOCAB_OVERLAY_WIDTH: f64 = 360.0;

/// Off-screen parking coordinate. `visible:true` keeps the WKWebView
/// attached and the React listener registered; teleporting here is how
/// we "hide" the window without actually toggling visibility.
const OFFSCREEN_X: f64 = -10_000.0;
const OFFSCREEN_Y: f64 = -10_000.0;
/// Position the pill just *below* the menu bar / notch. The camera cutout on
/// notched MBPs is ~32pt tall and occludes any pixels behind it in the
/// screen-center strip — rendering inside that area means the user sees
/// nothing. Hanging the pill a few points below keeps it fully visible and
/// reads as a Dynamic-Island-style chip. On non-notched Macs it sits a hair
/// below the menu bar, same vibe.
const OVERLAY_TOP_OFFSET: f64 = 36.0;

/// Show the overlay window with the given state ("listening" or "rewriting")
pub fn show(app: &AppHandle, state: &str) {
    let _ = app.emit_to("overlay", "overlay-state", state);

    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.set_shadow(false);
        if let Ok(Some(monitor)) = window.current_monitor() {
            let screen_size = monitor.size();
            let monitor_pos = monitor.position();
            let scale = monitor.scale_factor();
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                OVERLAY_WIDTH,
                OVERLAY_HEIGHT,
            )));
            let screen_width_pt = screen_size.width as f64 / scale;
            let monitor_x_pt = monitor_pos.x as f64 / scale;
            let monitor_y_pt = monitor_pos.y as f64 / scale;
            let x = monitor_x_pt + (screen_width_pt - OVERLAY_WIDTH) / 2.0;
            let y = monitor_y_pt + OVERLAY_TOP_OFFSET;
            let _ = window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        }
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.show();
        // Apply NSWindow-level tweaks AFTER show() so Tauri's own window-level
        // handling (driven by `alwaysOnTop`) doesn't clobber our setLevel call.
        #[cfg(target_os = "macos")]
        apply_fullscreen_overlay_behavior(&window);
    }
}

/// Tweak the overlay window's NSWindow so the pill follows the active app
/// into fullscreen Spaces and stays above the menu bar / fullscreen content.
///
/// `collectionBehavior` flags:
///   CanJoinAllSpaces    (1 << 0)  visible on every Space, not just one
///   Stationary          (1 << 4)  Mission Control doesn't shove it aside
///   FullScreenAuxiliary (1 << 8)  lets a floating window show over fullscreen
///
/// Tauri's `alwaysOnTop` only raises the window to NSFloatingWindowLevel (3),
/// which is below the menu bar (24) and below most fullscreen apps. Bump to
/// NSStatusWindowLevel (25) so the pill renders over both.
#[cfg(target_os = "macos")]
fn apply_fullscreen_overlay_behavior(window: &tauri::WebviewWindow) {
    use objc::runtime::{Class, Object};

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(error) => {
            log::warn!("overlay: could not get NSWindow handle: {}", error);
            return;
        }
    };
    let ns_window = ns_window_ptr as *mut Object;

    unsafe {
        // Class-swizzle the NSWindow into an NSPanel. NSWindow's
        // `FullScreenAuxiliary` collectionBehavior is unreliable across app
        // boundaries — when another app enters its own fullscreen Space, a
        // floating NSWindow stays behind. NSPanel honors the flag and is the
        // approach used by tauri-nspanel, Boring Notch, Bartender, Magnet,
        // etc. NSPanel is a subclass of NSWindow so a runtime class swap is
        // safe for our use (no decorations, no resize, fixed position).
        let panel_class: *const Class = class!(NSPanel);
        let current_class: *const Class = msg_send![ns_window, class];
        if current_class != panel_class {
            object_setClass(ns_window, panel_class);
        }

        // NSNonactivatingPanelMask (1 << 7) — clicking the pill won't steal
        // focus from whatever app the user is dictating into.
        let current_style: u64 = msg_send![ns_window, styleMask];
        let new_style: u64 = current_style | (1 << 7);
        let _: () = msg_send![ns_window, setStyleMask: new_style];

        // collectionBehavior:
        //   CanJoinAllSpaces    (1 << 0) — visible on every Space
        //   Stationary          (1 << 4) — Mission Control doesn't shove it
        //   FullScreenAuxiliary (1 << 8) — show over fullscreen apps
        let current_behavior: u64 = msg_send![ns_window, collectionBehavior];
        let behavior: u64 = current_behavior | 1 | (1 << 4) | (1 << 8);
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

        // NSScreenSaverWindowLevel - 1; combined with FullScreenAuxiliary on
        // an NSPanel this is the standard "above everything but the screen
        // saver" tier used by overlay tools.
        let _: () = msg_send![ns_window, setLevel: 999_i64];
    }
}

/// Hide the overlay by parking it off-screen. Dispatches to the main
/// thread. We deliberately don't call `window.hide()` — on this Tauri
/// + macOS combo, the WKWebView detaches when hidden and won't
/// re-attach on the next `show()`, leaving React un-mounted and the
/// pill invisible forever after.
pub fn hide(app: &AppHandle) {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_clone.get_webview_window("overlay") {
            park_offscreen(&window);
        }
    });
}

/// Teleport the overlay window to off-screen coordinates. Called at
/// startup (before the user could see the window flash on launch) and
/// in `hide()` to dismiss the pill. Must be called from the main thread.
pub fn park_offscreen(window: &tauri::WebviewWindow) {
    let _ = window.set_position(tauri::Position::Logical(
        tauri::LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y),
    ));
}

/// Public alias used by `lib.rs`'s startup hook. Same body as the
/// module-private `apply_fullscreen_overlay_behavior`.
#[cfg(target_os = "macos")]
pub fn apply_fullscreen_overlay_behavior_public(window: &tauri::WebviewWindow) {
    apply_fullscreen_overlay_behavior(window);
}

/// Tauri-managed state for the "next vocab term to show" — read+cleared
/// by the React component on mount via `take_pending_vocab_term`. We
/// stash here BEFORE emitting + showing, so a freshly-mounted React tree
/// can pick up the term even if the event fired before the listener was
/// registered.
#[derive(Default)]
pub struct PendingVocabTerm(pub std::sync::Mutex<Option<String>>);

/// Show the overlay configured as the vocab-prompt: wider pill, with
/// the term to add and an Add button. Reuses the exact same NSPanel /
/// positioning / FullScreenAuxiliary plumbing as the listening pill so
/// the window is guaranteed to actually paint on screen.
///
/// CRITICAL: all NSWindow operations are dispatched to the main thread
/// via `run_on_main_thread`. On macOS, `WKWebView.show()` and the
/// NSPanel-class swizzle MUST run on the main thread or they silently
/// no-op the paint. The old listening pill happened to be invoked from
/// the global-shortcut callback (which IS the main thread), so it
/// didn't need this — but our `show_vocab_prompt` is a `#[tauri::command]`
/// handler, which runs on a tokio worker. Without `run_on_main_thread`
/// the show() call returns Ok but the window never paints, which is
/// the exact symptom we've been chasing.
pub fn show_vocab(app: &AppHandle, term: &str) {
    // 1. Stash the term so a freshly-mounted React tree can take-and-clear it.
    if let Some(pending) = app.try_state::<PendingVocabTerm>() {
        *pending.0.lock().unwrap() = Some(term.to_string());
    } else {
        log::warn!("overlay: PendingVocabTerm state not registered");
    }

    // 2. Wake up the React tree. We've confirmed Tauri events from a
    //    command's worker thread DO NOT reach the overlay webview
    //    reliably. So we bypass the event system entirely via
    //    `WebviewWindow::eval()`. Also fire a direct invoke from raw
    //    JS as a diagnostic — if the React-exposed `__vocabWake`
    //    isn't there, the raw invoke will still hit Rust and log,
    //    proving whether eval() reaches the webview at all.
    if let Some(overlay_win) = app.get_webview_window("overlay") {
        let eval_js = r#"
            (function() {
                if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                    window.__TAURI__.core.invoke('frontend_ping', { label: 'eval-reached-webview' });
                }
                if (typeof window.__vocabWake === 'function') {
                    window.__vocabWake();
                } else if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                    window.__TAURI__.core.invoke('frontend_ping', { label: 'eval-but-no-__vocabWake' });
                }
            })();
        "#;
        match overlay_win.eval(eval_js) {
            Ok(()) => log::info!("overlay: eval() dispatched"),
            Err(e) => log::warn!("overlay: eval() failed: {}", e),
        }
    }

    // 3. Teleport the always-shown window onto the screen from its
    //    off-screen parking spot. NSWindow ops must hop to the main thread.
    let app_clone = app.clone();
    let dispatch = app.run_on_main_thread(move || {
        let Some(window) = app_clone.get_webview_window("overlay") else {
            log::warn!("overlay: window 'overlay' not found, can't show_vocab");
            return;
        };
        let _ = window.set_shadow(false);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            VOCAB_OVERLAY_WIDTH,
            OVERLAY_HEIGHT,
        )));

        // The overlay window is parked off-screen, so `current_monitor()`
        // on it returns None ("no monitor contains this window"). Query
        // the main window instead — it lives on a real screen — and fall
        // back to the app's primary_monitor() as a last resort.
        let monitor = app_clone
            .get_webview_window("main")
            .and_then(|w| w.current_monitor().ok().flatten())
            .or_else(|| window.primary_monitor().ok().flatten())
            .or_else(|| window.available_monitors().ok().and_then(|ms| ms.into_iter().next()));

        if let Some(monitor) = monitor {
            let screen_size = monitor.size();
            let monitor_pos = monitor.position();
            let scale = monitor.scale_factor();
            let screen_width_pt = screen_size.width as f64 / scale;
            let monitor_x_pt = monitor_pos.x as f64 / scale;
            let monitor_y_pt = monitor_pos.y as f64 / scale;
            let x = monitor_x_pt + (screen_width_pt - VOCAB_OVERLAY_WIDTH) / 2.0;
            let y = monitor_y_pt + OVERLAY_TOP_OFFSET;
            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition::new(x, y),
            ));
            log::info!("overlay: show_vocab teleported on-screen to ({:.1}, {:.1})", x, y);
        } else {
            // Absolute last-ditch: park at (40, 36). Better than the
            // window staying off-screen with no signal to the user.
            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition::new(40.0, OVERLAY_TOP_OFFSET),
            ));
            log::warn!("overlay: show_vocab couldn't read any monitor; falling back to (40, 36)");
        }
        // Vocab prompt is interactive — cursor events must reach the pill.
        let _ = window.set_ignore_cursor_events(false);
        // Re-apply NSPanel behavior defensively (idempotent).
        #[cfg(target_os = "macos")]
        apply_fullscreen_overlay_behavior(&window);
    });
    if let Err(e) = dispatch {
        log::warn!("overlay: run_on_main_thread dispatch failed: {}", e);
    }
}
