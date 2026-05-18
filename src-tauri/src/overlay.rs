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

const OVERLAY_WIDTH: f64 = 220.0;
const OVERLAY_HEIGHT: f64 = 40.0;
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

/// Hide the overlay window
pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}
