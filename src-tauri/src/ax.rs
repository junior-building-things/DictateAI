//! macOS Accessibility helpers — reading text from the focused element and
//! subscribing to value-changed notifications on it. Used by the
//! "learn-from-edits" feature: after we paste a dictation, we subscribe to
//! the focused element via `AXObserver`, and when the user edits the text
//! in the destination app the OS calls us back. Sub-second latency, no
//! polling.
//!
//! Implementation notes:
//!   - Raw FFI for `ApplicationServices.framework`'s `AXUIElement*` and
//!     `AXObserver*` APIs. No Rust crate in our dep tree wraps these.
//!   - The C callback runs on whatever thread is processing the main
//!     `CFRunLoop` (always the macOS main thread). Our Rust closure is
//!     stored boxed behind the `refcon` pointer and dispatched from the
//!     C trampoline.
//!   - Observer's run-loop source is added to `CFRunLoopGetMain()` — Tauri
//!     runs that loop as the app's event loop, so registering a source
//!     there means the callback fires inside Tauri's existing main-thread
//!     dispatch, no extra thread spun up.
//!   - Many Electron / WebView text fields don't expose `AXValue` /
//!     don't fire `AXValueChanged`. Subscribe still "succeeds" (no error)
//!     but the callback never fires. We accept this silent degradation.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::os::raw::c_int;

use core_foundation::base::{CFGetTypeID, CFRelease, CFRetain, CFType, CFTypeID, CFTypeRef, TCFType};
use core_foundation::runloop::{
    kCFRunLoopDefaultMode, CFRunLoopAddSource, CFRunLoopGetMain, CFRunLoopRemoveSource,
    CFRunLoopSourceRef,
};
use core_foundation::string::{CFString, CFStringRef};

type AXUIElementRef = *const c_void;
type AXObserverRef = *const c_void;
type AXError = i32;
type Pid = c_int;

const AX_ERROR_SUCCESS: AXError = 0;

type AXObserverCallbackFn = extern "C" fn(
    observer: AXObserverRef,
    element: AXUIElementRef,
    notification: CFStringRef,
    refcon: *mut c_void,
);

type AXValueRef = *const c_void;
type AXValueType = u32;

const K_AX_VALUE_CG_POINT_TYPE: AXValueType = 1;
const K_AX_VALUE_CG_SIZE_TYPE: AXValueType = 2;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

/// On-screen rectangle of the focused AX element, in points (top-left
/// origin, same as `NSWindow::setFrameOrigin:` expects).
#[derive(Debug, Clone, Copy)]
pub struct FocusedFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut Pid) -> AXError;

    fn AXObserverCreate(
        application: Pid,
        callback: AXObserverCallbackFn,
        out_observer: *mut AXObserverRef,
    ) -> AXError;
    fn AXObserverAddNotification(
        observer: AXObserverRef,
        element: AXUIElementRef,
        notification: CFStringRef,
        refcon: *mut c_void,
    ) -> AXError;
    fn AXObserverRemoveNotification(
        observer: AXObserverRef,
        element: AXUIElementRef,
        notification: CFStringRef,
    ) -> AXError;
    fn AXObserverGetRunLoopSource(observer: AXObserverRef) -> CFRunLoopSourceRef;

    fn AXValueGetType(value: AXValueRef) -> AXValueType;
    fn AXValueGetValue(
        value: AXValueRef,
        the_type: AXValueType,
        value_ptr: *mut c_void,
    ) -> bool;
}

extern "C" {
    fn CFStringGetTypeID() -> CFTypeID;
}

/// Read whichever text element the OS currently reports as focused. Returns
/// `None` when Accessibility permission isn't granted, no element is
/// focused, the focused element doesn't expose `AXValue`, or that value
/// isn't a string.
pub fn read_focused_text() -> Option<String> {
    unsafe {
        let element = copy_focused_element()?;
        let element_ref = element.as_concrete_TypeRef() as AXUIElementRef;
        copy_text_from_element(element_ref)
    }
}

/// Read the on-screen rectangle of the currently-focused element. Used by
/// `vocab_prompt::show` to position the "Add 'X' to vocabulary?" pill
/// directly above the field the user is editing.
///
/// Returns `None` for elements that don't expose `AXPosition`/`AXSize`
/// (common with web/Electron text inputs). Caller should fall back to a
/// fixed corner position in that case.
pub fn read_focused_frame() -> Option<FocusedFrame> {
    unsafe {
        let element = copy_focused_element()?;
        let element_ref = element.as_concrete_TypeRef() as AXUIElementRef;

        let pos = copy_attribute(element_ref, "AXPosition")?;
        let size = copy_attribute(element_ref, "AXSize")?;
        let pos_ref = pos.as_concrete_TypeRef() as AXValueRef;
        let size_ref = size.as_concrete_TypeRef() as AXValueRef;

        // Both come back as opaque AXValueRef wrapping CGPoint/CGSize.
        // Unpack via the matching type id.
        if AXValueGetType(pos_ref) != K_AX_VALUE_CG_POINT_TYPE {
            return None;
        }
        if AXValueGetType(size_ref) != K_AX_VALUE_CG_SIZE_TYPE {
            return None;
        }
        let mut point = CGPoint { x: 0.0, y: 0.0 };
        let mut sz = CGSize { width: 0.0, height: 0.0 };
        if !AXValueGetValue(
            pos_ref,
            K_AX_VALUE_CG_POINT_TYPE,
            &mut point as *mut CGPoint as *mut c_void,
        ) {
            return None;
        }
        if !AXValueGetValue(
            size_ref,
            K_AX_VALUE_CG_SIZE_TYPE,
            &mut sz as *mut CGSize as *mut c_void,
        ) {
            return None;
        }
        // Reject degenerate frames — common for off-screen or hidden
        // elements; placing the pill against them would put it somewhere
        // useless. Caller falls back to top-right of the active monitor.
        if sz.width < 4.0 || sz.height < 4.0 {
            return None;
        }
        Some(FocusedFrame {
            x: point.x,
            y: point.y,
            width: sz.width,
            height: sz.height,
        })
    }
}

/// Subscribe to value-changed notifications on the currently-focused text
/// element. Returns a handle that owns the observer + boxed callback; drop
/// it to tear everything down (notification, run-loop source, retains).
///
/// `on_change` runs on the macOS main thread each time the focused
/// element's value changes. Keep it small — read the current text, do
/// cheap work, hand off to a tokio task for anything heavier.
///
/// Returns `None` when no element is focused, the focused element doesn't
/// belong to a known process, or AXObserver creation fails (rare —
/// usually only when Accessibility permission was revoked).
pub fn subscribe_to_focused_value_changes<F>(on_change: F) -> Option<ValueChangeObserver>
where
    F: Fn(String) + Send + 'static,
{
    unsafe {
        // 1. Get the focused element. We need to retain it because we'll
        //    hold the raw pointer beyond this scope (for use as the target
        //    of AXObserverAddNotification and later AXObserverRemoveNotification).
        let focused = copy_focused_element()?;
        let element_ref = focused.as_concrete_TypeRef() as AXUIElementRef;
        CFRetain(element_ref as CFTypeRef);
        // `focused` will release its handle on drop; we keep `element_ref`
        // alive via the extra retain we just bumped.

        // 2. Figure out which process owns the element. AXObserver is
        //    per-process — without the right pid the observer just never
        //    fires.
        let mut pid: Pid = 0;
        let err = AXUIElementGetPid(element_ref, &mut pid);
        if err != AX_ERROR_SUCCESS {
            CFRelease(element_ref as CFTypeRef);
            return None;
        }

        // 3. Create the observer.
        let mut observer: AXObserverRef = std::ptr::null();
        let err = AXObserverCreate(pid, ax_observer_trampoline, &mut observer);
        if err != AX_ERROR_SUCCESS || observer.is_null() {
            CFRelease(element_ref as CFTypeRef);
            return None;
        }

        // 4. Box the callback so we can pass it through C-land via refcon.
        //    Double-box: outer Box gives us a fixed-size *mut, inner Box<dyn>
        //    is the actual fat pointer to the closure.
        let boxed: Box<dyn Fn(String) + Send> = Box::new(on_change);
        let outer: Box<Box<dyn Fn(String) + Send>> = Box::new(boxed);
        let refcon: *mut c_void = Box::into_raw(outer) as *mut c_void;

        // 5. Subscribe to AXValueChanged on the focused element.
        let notification = CFString::new("AXValueChanged");
        let err = AXObserverAddNotification(
            observer,
            element_ref,
            notification.as_concrete_TypeRef(),
            refcon,
        );
        if err != AX_ERROR_SUCCESS {
            // Recover the box so it gets dropped properly.
            drop(Box::from_raw(refcon as *mut Box<dyn Fn(String) + Send>));
            CFRelease(observer as CFTypeRef);
            CFRelease(element_ref as CFTypeRef);
            return None;
        }

        // 6. Wire the observer into the main run loop so the trampoline
        //    actually fires when notifications come in.
        let source = AXObserverGetRunLoopSource(observer);
        let main_loop = CFRunLoopGetMain();
        CFRunLoopAddSource(main_loop, source, kCFRunLoopDefaultMode);

        Some(ValueChangeObserver {
            observer,
            element: element_ref,
            notification,
            callback_ptr: refcon,
        })
    }
}

/// Owns an active AX observer subscription. Drop to tear it down — removes
/// the notification, removes the run-loop source, releases the AX objects,
/// and frees the boxed Rust callback.
pub struct ValueChangeObserver {
    observer: AXObserverRef,
    element: AXUIElementRef,
    notification: CFString,
    /// `*mut Box<dyn Fn(String) + Send>`, stored as `*mut c_void` so the
    /// struct is `Sized`. Recovered via `Box::from_raw` in `Drop`.
    callback_ptr: *mut c_void,
}

impl Drop for ValueChangeObserver {
    fn drop(&mut self) {
        unsafe {
            // 1. Stop further callbacks first — this prevents a race where
            //    a notification fires while we're tearing down the Box.
            let _ = AXObserverRemoveNotification(
                self.observer,
                self.element,
                self.notification.as_concrete_TypeRef(),
            );
            // 2. Unregister the run-loop source.
            let source = AXObserverGetRunLoopSource(self.observer);
            let main_loop = CFRunLoopGetMain();
            CFRunLoopRemoveSource(main_loop, source, kCFRunLoopDefaultMode);
            // 3. Release the AX objects.
            CFRelease(self.observer as CFTypeRef);
            CFRelease(self.element as CFTypeRef);
            // 4. Reclaim and drop the boxed callback.
            drop(Box::from_raw(
                self.callback_ptr as *mut Box<dyn Fn(String) + Send>,
            ));
        }
    }
}

// AXObserver's docs say the API is thread-safe enough for "create on one
// thread, dispatch on the run-loop's thread". Our usage matches: we move
// the handle between threads only via tokio (no concurrent calls), and
// the C callback runs strictly on the main thread.
unsafe impl Send for ValueChangeObserver {}
// Sync because the only cross-thread access is `read_current_text` which
// is a `AXUIElementCopyAttributeValue` call — AX reads are thread-safe.
unsafe impl Sync for ValueChangeObserver {}

impl ValueChangeObserver {
    /// Read the current text from the SPECIFIC element this observer is
    /// bound to (the one focused at subscription time). Distinct from
    /// `read_focused_text()` — that one always reads whatever has focus
    /// right now, which after a "send" action in chat apps often jumps
    /// to a different element (message history, etc.) and gives us
    /// wildly wrong values for clear-detection.
    pub fn read_current_text(&self) -> Option<String> {
        unsafe { copy_text_from_element(self.element) }
    }
}

// -- internals -------------------------------------------------------------

unsafe fn copy_focused_element() -> Option<CFType> {
    let system_wide = AXUIElementCreateSystemWide();
    if system_wide.is_null() {
        return None;
    }
    let focused = copy_attribute(system_wide, "AXFocusedUIElement");
    CFRelease(system_wide as CFTypeRef);
    focused
}

unsafe fn copy_attribute(element: AXUIElementRef, name: &str) -> Option<CFType> {
    let attr = CFString::new(name);
    let mut value: CFTypeRef = std::ptr::null();
    let err =
        AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value);
    if err != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }
    Some(CFType::wrap_under_create_rule(value))
}

unsafe fn copy_text_from_element(element: AXUIElementRef) -> Option<String> {
    let value_attr = CFString::new("AXValue");
    let mut value: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(
        element,
        value_attr.as_concrete_TypeRef(),
        &mut value,
    );
    if err != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }
    if CFGetTypeID(value) != CFStringGetTypeID() {
        CFRelease(value);
        return None;
    }
    let cfstr = CFString::wrap_under_create_rule(value as CFStringRef);
    Some(cfstr.to_string())
}

/// C trampoline: bridges the AXObserver callback into our boxed Rust
/// closure. Runs on the main thread (whichever thread `CFRunLoopGetMain`'s
/// loop processes events on).
extern "C" fn ax_observer_trampoline(
    _observer: AXObserverRef,
    element: AXUIElementRef,
    _notification: CFStringRef,
    refcon: *mut c_void,
) {
    if refcon.is_null() || element.is_null() {
        return;
    }
    // SAFETY: refcon was set in `subscribe_to_focused_value_changes` to a
    // `Box<Box<dyn Fn(String) + Send>>::into_raw()`. We're alive as long
    // as the `ValueChangeObserver` is — its Drop removes the notification
    // before dropping the Box, so this deref is sound.
    let callback: &Box<dyn Fn(String) + Send> =
        unsafe { &*(refcon as *const Box<dyn Fn(String) + Send>) };

    // Read the element's current text — we hand it to the Rust closure so
    // callers don't have to do their own AX call.
    let value = unsafe { copy_text_from_element(element) };
    if let Some(text) = value {
        callback(text);
    }
}
