//! Right-Option-key hotkey detector for macOS.
//!
//! macOS's standard hotkey registration (Carbon `RegisterEventHotKey`, used
//! by `tauri-plugin-global-shortcut`) doesn't accept modifier-only bindings
//! like bare right-Option. This module installs `NSEvent` monitors instead
//! — both a *global* monitor (catches events from other apps) and a *local*
//! monitor (catches events delivered to DictateAI's own windows). Together
//! they fire reliably regardless of which app has focus.
//!
//! ### State machine
//!
//! When right-Option goes down we enter `Held { cancelled: false, ... }`.
//! Any other key pressed while we're in that state flips `cancelled = true`
//! and, in hold-mode, aborts the in-flight recording — so right-Option
//! continues to work as a normal modifier for character input (option-L for
//! ¬, etc.). When right-Option goes up we dispatch based on cancellation
//! status and the user's hotkey_mode setting:
//!
//!   | mode    | clean release           | cancelled release |
//!   |---------|-------------------------|-------------------|
//!   | hold    | stop + run pipeline     | already aborted   |
//!   | toggle  | toggle (start or stop)  | no-op             |
//!
//! In hold-mode the recording starts on the press itself (so the user can
//! talk immediately); in toggle-mode nothing happens until release, since
//! we have to wait to see whether it's a cancellation or a real tap.

#![cfg(target_os = "macos")]

use std::sync::{Arc, Mutex};
use std::time::Instant;

use block::ConcreteBlock;
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use tauri::{AppHandle, Manager};

use crate::db::settings;
use crate::hotkey::handler::{self, HotkeyState};
use crate::state::AppState;

/// `kVK_RightOption` from `<HIToolbox/Events.h>`. The left side is `0x3A`.
const KVK_RIGHT_OPTION: u16 = 0x3D;

/// `NSEventMaskFlagsChanged` = `1 << NSEventTypeFlagsChanged` = `1 << 12`.
/// `NSEventMaskKeyDown`     = `1 << NSEventTypeKeyDown`     = `1 << 10`.
const NSEVENT_MASK_FLAGS_CHANGED: u64 = 1 << 12;
const NSEVENT_MASK_KEY_DOWN: u64 = 1 << 10;
const NSEVENT_TYPE_KEY_DOWN: u64 = 10;
const NSEVENT_TYPE_FLAGS_CHANGED: u64 = 12;

/// Device-dependent right-Option flag bit (`NX_DEVICERALTKEYMASK` from
/// `<IOKit/hidsystem/IOLLEvent.h>`). Distinct from `kCGEventFlagMaskAlternate`
/// which doesn't differentiate left from right.
const RIGHT_ALT_FLAG_BIT: u64 = 0x40;

/// Held in `app.manage(...)` as Tauri-managed state so commands can start
/// and stop the monitor at runtime when the user changes their hotkey.
pub struct RightOptionMonitor {
    inner: Mutex<MonitorInner>,
}

struct MonitorInner {
    state: Arc<Mutex<MonitorState>>,
    global_handle: Option<usize>,
    local_handle: Option<usize>,
}

#[derive(Default)]
struct MonitorState {
    held: Option<HeldInfo>,
}

struct HeldInfo {
    #[allow(dead_code)] // kept for future logging / metrics
    started_at: Instant,
    cancelled: bool,
    /// Whether on_pressed was called when this hold began. Only true in
    /// hold-mode; toggle-mode defers all action to release.
    recording: bool,
}

impl Default for RightOptionMonitor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(MonitorInner {
                state: Arc::new(Mutex::new(MonitorState::default())),
                global_handle: None,
                local_handle: None,
            }),
        }
    }
}

impl RightOptionMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Install the monitor if it isn't already running. Idempotent.
    pub fn start(&self, app: AppHandle) {
        let mut inner = self.inner.lock().unwrap();
        if inner.global_handle.is_some() {
            return;
        }

        // Reset state — a previous run might have left us mid-press.
        *inner.state.lock().unwrap() = MonitorState::default();

        let mask = NSEVENT_MASK_FLAGS_CHANGED | NSEVENT_MASK_KEY_DOWN;
        let nsevent_class = class!(NSEvent);

        // Global monitor: events for other apps. Handler returns void.
        let state_for_global = Arc::clone(&inner.state);
        let app_for_global = app.clone();
        let global_block = ConcreteBlock::new(move |event: *mut Object| {
            handle_event(&app_for_global, &state_for_global, event);
        });
        let global_block = global_block.copy();
        let global_handle: *mut Object = unsafe {
            msg_send![nsevent_class,
                addGlobalMonitorForEventsMatchingMask: mask
                handler: &*global_block]
        };

        // Local monitor: events for our own windows. Handler returns the
        // event (or nil to swallow it). We pass through unmodified so
        // normal text input in our own UI keeps working.
        let state_for_local = Arc::clone(&inner.state);
        let app_for_local = app.clone();
        let local_block = ConcreteBlock::new(move |event: *mut Object| -> *mut Object {
            handle_event(&app_for_local, &state_for_local, event);
            event
        });
        let local_block = local_block.copy();
        let local_handle: *mut Object = unsafe {
            msg_send![nsevent_class,
                addLocalMonitorForEventsMatchingMask: mask
                handler: &*local_block]
        };

        // The blocks need to outlive `start()`. We leak them intentionally;
        // since the monitor lives for the lifetime of the app (or until
        // `stop()` removes the handlers), this is one-time leak, not a
        // per-event one. The handles themselves are stored as `usize` to
        // sidestep raw-pointer Send/Sync concerns.
        std::mem::forget(global_block);
        std::mem::forget(local_block);

        inner.global_handle = Some(global_handle as usize);
        inner.local_handle = Some(local_handle as usize);
        log::info!("Right-Option monitor: installed");
    }

    /// Tear down the monitor. Idempotent.
    pub fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        let nsevent_class = class!(NSEvent);
        if let Some(handle) = inner.global_handle.take() {
            unsafe {
                let obj = handle as *mut Object;
                let _: () = msg_send![nsevent_class, removeMonitor: obj];
            }
        }
        if let Some(handle) = inner.local_handle.take() {
            unsafe {
                let obj = handle as *mut Object;
                let _: () = msg_send![nsevent_class, removeMonitor: obj];
            }
        }
        *inner.state.lock().unwrap() = MonitorState::default();
        log::info!("Right-Option monitor: removed");
    }
}

// Safe because we serialize access via the inner Mutex and the NSEvent
// handles are retained by AppKit; we just hold opaque references.
unsafe impl Send for RightOptionMonitor {}
unsafe impl Sync for RightOptionMonitor {}

fn handle_event(
    app: &AppHandle,
    state: &Arc<Mutex<MonitorState>>,
    event: *mut Object,
) {
    if event.is_null() {
        return;
    }

    let event_type: u64 = unsafe { msg_send![event, type] };

    if event_type == NSEVENT_TYPE_FLAGS_CHANGED {
        let keycode: u16 = unsafe { msg_send![event, keyCode] };
        if keycode == KVK_RIGHT_OPTION {
            let modifier_flags: u64 = unsafe { msg_send![event, modifierFlags] };
            let down = (modifier_flags & RIGHT_ALT_FLAG_BIT) != 0;
            if down {
                on_right_option_down(app, state);
            } else {
                on_right_option_up(app, state);
            }
        } else {
            // Some other modifier (Cmd / Shift / Ctrl / left-Option) was
            // pressed or released. If we're mid-hold, treat it as a
            // cancellation — the user is combining right-Option with
            // other modifiers, not invoking us.
            mark_cancelled(app, state);
        }
    } else if event_type == NSEVENT_TYPE_KEY_DOWN {
        // A regular (non-modifier) key was pressed. Cancellation if we're
        // mid-hold; harmless otherwise.
        mark_cancelled(app, state);
    }
}

fn on_right_option_down(app: &AppHandle, state: &Arc<Mutex<MonitorState>>) {
    let mode = hotkey_mode(app);
    let app_state = app.state::<AppState>();
    let hk = app.state::<HotkeyState>();

    let recording = {
        let mut st = state.lock().unwrap();
        if st.held.is_some() {
            // Autorepeat or duplicate flagsChanged. Ignore — we're already tracking.
            return;
        }
        if mode == "hold" {
            // Start recording immediately so the user can begin speaking
            // without latency. If they press another key during the hold,
            // `mark_cancelled` will abort it.
            handler::on_pressed(app, &hk, &app_state);
            st.held = Some(HeldInfo {
                started_at: Instant::now(),
                cancelled: false,
                recording: true,
            });
            true
        } else {
            // Toggle-mode: don't fire until we see the release (so we can
            // distinguish "intentional tap" from "modifier+key combo").
            st.held = Some(HeldInfo {
                started_at: Instant::now(),
                cancelled: false,
                recording: false,
            });
            false
        }
    };
    log::info!(
        "Right-Option DOWN (mode={}, started_recording={})",
        mode, recording
    );
}

fn on_right_option_up(app: &AppHandle, state: &Arc<Mutex<MonitorState>>) {
    let info_opt = {
        let mut st = state.lock().unwrap();
        st.held.take()
    };
    let Some(info) = info_opt else {
        // Got an UP without a recorded DOWN — probably the monitor was
        // installed mid-press. Ignore.
        return;
    };

    if info.cancelled {
        // mark_cancelled already aborted the recording (if any) when the
        // other key came in; nothing more to do here.
        log::info!("Right-Option UP: cancelled (modifier-use), no trigger");
        return;
    }

    let mode = hotkey_mode(app);
    log::info!("Right-Option UP (mode={}, was_recording={})", mode, info.recording);
    let app_state = app.state::<AppState>();
    let hk = app.state::<HotkeyState>();

    match mode.as_str() {
        "hold" => {
            // Normal stop + process.
            if info.recording {
                if let Some(audio_data) = handler::on_released(app, &hk, &app_state) {
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        handler::finalize_recording(app_clone, audio_data).await;
                    });
                }
            }
        }
        _ => {
            // Toggle: if idle, start; if recording, stop + process.
            if app_state.is_recording() {
                if let Some(audio_data) = handler::on_released(app, &hk, &app_state) {
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        handler::finalize_recording(app_clone, audio_data).await;
                    });
                }
            } else if app_state.is_idle() {
                handler::on_pressed(app, &hk, &app_state);
            }
        }
    }
}

fn mark_cancelled(app: &AppHandle, state: &Arc<Mutex<MonitorState>>) {
    let should_abort = {
        let mut st = state.lock().unwrap();
        if let Some(info) = st.held.as_mut() {
            if info.cancelled {
                return; // already cancelled
            }
            info.cancelled = true;
            let was_recording = info.recording;
            info.recording = false;
            was_recording
        } else {
            return;
        }
    };
    if should_abort {
        let hk = app.state::<HotkeyState>();
        let app_state = app.state::<AppState>();
        handler::abort_recording(&hk, &app_state);
    }
}

fn hotkey_mode(app: &AppHandle) -> String {
    let app_state = app.state::<AppState>();
    let db = app_state.db.lock().unwrap();
    settings::get(&db, "hotkey_mode").unwrap_or_else(|_| "hold".into())
}
