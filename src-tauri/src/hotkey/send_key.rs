//! Lightweight global monitor for "the user pressed Return to send".
//!
//! Used by the edit monitor (`pipeline::spawn_edit_monitor`) to commit
//! the user's edits to vocabulary the moment they hit Enter, rather than
//! trying to deduce "they sent" from heuristics on the focused element's
//! AX value (which varies wildly between apps — Slack/Lark/Discord all
//! handle the post-send DOM/AX differently).
//!
//! Watches both global (other apps) and local (our own windows) NSEvent
//! `keyDown` streams via passive monitors — we don't consume the event,
//! the Return still reaches the focused app and triggers its send. We
//! just observe.
//!
//! Filtering:
//!   - Trigger on key codes 36 (`kVK_Return`) and 76 (`kVK_ANSI_KeypadEnter`).
//!   - Skip if Shift is held — that's "insert newline" in every chat
//!     app worth supporting (Slack, iMessage, Lark, Discord, WhatsApp).
//!   - Cmd+Return is treated as send (Slack with "press Enter to send"
//!     turned off uses Cmd+Return; we want to catch both conventions).

#![cfg(target_os = "macos")]

use std::sync::{Arc, Mutex};

use block::ConcreteBlock;
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};

/// `kVK_Return` from `<HIToolbox/Events.h>`.
const KVK_RETURN: u16 = 36;
/// `kVK_ANSI_KeypadEnter`.
const KVK_KEYPAD_ENTER: u16 = 76;

/// `NSEventMaskKeyDown` = `1 << NSEventTypeKeyDown` = `1 << 10`.
const NSEVENT_MASK_KEY_DOWN: u64 = 1 << 10;

/// `NSEventModifierFlagShift` from `<AppKit/NSEvent.h>`.
const NSEVENT_MODIFIER_SHIFT: u64 = 1 << 17;

/// Held by the caller for the lifetime of the monitor. Drop removes both
/// the global and local NSEvent monitors.
pub struct SendKeyMonitor {
    inner: Mutex<Inner>,
}

struct Inner {
    global_handle: Option<usize>,
    local_handle: Option<usize>,
}

impl SendKeyMonitor {
    /// Install a global+local keyDown monitor that invokes `callback`
    /// every time Return / Keypad-Enter is pressed without Shift held.
    /// Callback runs on the macOS main thread; keep it small.
    pub fn new<F>(callback: F) -> Self
    where
        F: Fn() + Send + Sync + 'static,
    {
        let callback = Arc::new(callback);
        let cb_for_global = Arc::clone(&callback);
        let cb_for_local = Arc::clone(&callback);

        let nsevent_class = class!(NSEvent);
        let mask = NSEVENT_MASK_KEY_DOWN;

        // Global monitor: events targeted at other apps. Handler returns void.
        let global_block = ConcreteBlock::new(move |event: *mut Object| {
            if unsafe { is_send_key(event) } {
                cb_for_global();
            }
        });
        let global_block = global_block.copy();
        let global_handle: *mut Object = unsafe {
            msg_send![nsevent_class,
                addGlobalMonitorForEventsMatchingMask: mask
                handler: &*global_block]
        };

        // Local monitor: events targeted at our own windows. Handler must
        // return the event (we pass it through unmodified).
        let local_block =
            ConcreteBlock::new(move |event: *mut Object| -> *mut Object {
                if unsafe { is_send_key(event) } {
                    cb_for_local();
                }
                event
            });
        let local_block = local_block.copy();
        let local_handle: *mut Object = unsafe {
            msg_send![nsevent_class,
                addLocalMonitorForEventsMatchingMask: mask
                handler: &*local_block]
        };

        // Blocks need to outlive `new()` — the AX dispatcher keeps copies
        // and calls them per event. One-time leak, not per-event.
        std::mem::forget(global_block);
        std::mem::forget(local_block);

        Self {
            inner: Mutex::new(Inner {
                global_handle: Some(global_handle as usize),
                local_handle: Some(local_handle as usize),
            }),
        }
    }
}

impl Drop for SendKeyMonitor {
    fn drop(&mut self) {
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
    }
}

// Send/Sync because the inner Mutex serializes the only stateful access
// (Drop), and AppKit retains the NSEvent monitor pointers we hold.
unsafe impl Send for SendKeyMonitor {}
unsafe impl Sync for SendKeyMonitor {}

/// Inspect an NSEvent and decide whether this keystroke is a "send".
unsafe fn is_send_key(event: *mut Object) -> bool {
    if event.is_null() {
        return false;
    }
    let keycode: u16 = msg_send![event, keyCode];
    if keycode != KVK_RETURN && keycode != KVK_KEYPAD_ENTER {
        return false;
    }
    let modifier_flags: u64 = msg_send![event, modifierFlags];
    // Reject Shift+Return — that's "insert newline" in every chat app
    // worth supporting. Cmd+Return is acceptable (Slack-style send).
    (modifier_flags & NSEVENT_MODIFIER_SHIFT) == 0
}
