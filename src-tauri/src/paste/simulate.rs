use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::{Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult};

pub fn insert_text(text: &str) -> AppResult<()> {
    if text.is_empty() {
        return Ok(());
    }

    if !check_accessibility() {
        log::warn!("Accessibility permission not granted — skipping auto-paste");
        return Err(AppError::Clipboard(
            "Accessibility permission not granted. Go to System Settings → Privacy & Security → Accessibility and add this app.".into()
        ));
    }

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| AppError::Clipboard(format!("Failed to create input simulator: {}", e)))?;
    enigo
        .text(text)
        .map_err(|e| AppError::Clipboard(format!("Failed to insert text: {}", e)))?;
    log::info!(
        "Text inserted directly into focused field ({} chars)",
        text.len()
    );
    Ok(())
}

/// Select `n` characters to the left of the cursor by holding Shift and
/// pressing Left Arrow `n` times. Used to highlight a placeholder we just
/// typed so we can replace it.
///
/// Uses a reduced `mac_delay` (1ms vs the default 12ms) so the selection
/// animation completes in ~12ms instead of ~150ms for a 12-char placeholder
/// — visually imperceptible in most apps.
fn select_left(n: usize) -> AppResult<()> {
    if n == 0 {
        return Ok(());
    }
    let fast_settings = Settings {
        mac_delay: 1,
        ..Settings::default()
    };
    let mut enigo = Enigo::new(&fast_settings)
        .map_err(|e| AppError::Clipboard(format!("Failed to create input simulator: {}", e)))?;
    enigo
        .key(Key::Shift, Direction::Press)
        .map_err(|e| AppError::Clipboard(format!("Shift-press failed: {}", e)))?;
    for _ in 0..n {
        enigo
            .key(Key::LeftArrow, Direction::Click)
            .map_err(|e| AppError::Clipboard(format!("LeftArrow click failed: {}", e)))?;
    }
    enigo
        .key(Key::Shift, Direction::Release)
        .map_err(|e| AppError::Clipboard(format!("Shift-release failed: {}", e)))?;
    Ok(())
}

/// Highlight the last `len` chars (presumed to be a placeholder we typed
/// earlier) and replace them with `replacement`. If `replacement` is empty,
/// the placeholder is just deleted.
pub fn replace_placeholder(len: usize, replacement: &str) -> AppResult<()> {
    if len == 0 {
        return insert_text(replacement);
    }
    select_left(len)?;
    if replacement.is_empty() {
        // Backspace clears the active selection.
        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| AppError::Clipboard(format!("Failed to create input simulator: {}", e)))?;
        enigo
            .key(Key::Backspace, Direction::Click)
            .map_err(|e| AppError::Clipboard(format!("Backspace failed: {}", e)))?;
        log::info!("Deleted {}-char placeholder", len);
    } else {
        // Typing while a selection is active overwrites it.
        insert_text(replacement)?;
        log::info!(
            "Replaced {}-char placeholder with {} chars",
            len,
            replacement.len()
        );
    }
    Ok(())
}

/// Highlight and delete the last `len` chars. Used by the pipeline cleanup
/// path when a placeholder is left over after a failure or empty rewrite.
pub fn delete_placeholder(len: usize) -> AppResult<()> {
    replace_placeholder(len, "")
}

pub fn copy_text<R: Runtime, T: Manager<R>>(manager: &T, text: &str) -> AppResult<()> {
    if text.is_empty() {
        return Ok(());
    }

    manager.clipboard().write_text(text).map_err(|error| {
        AppError::Clipboard(format!("Failed to copy text to clipboard: {}", error))
    })?;
    log::info!("Text copied to clipboard ({} chars)", text.len());
    Ok(())
}

/// Check if the app has Accessibility permission on macOS.
pub fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_check()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn prompt_accessibility_permission() {
    #[cfg(target_os = "macos")]
    {
        match macos_prompt_accessibility_permission() {
            Some(true) | None => open_accessibility_settings(),
            Some(false) => {}
        }
    }
}

pub fn prompt_microphone_permission() {
    #[cfg(target_os = "macos")]
    {
        if macos_microphone_permission_state() == "granted" {
            return;
        }

        let _ = std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn();
    }
}

pub fn check_microphone_permission() -> String {
    #[cfg(target_os = "macos")]
    {
        macos_microphone_permission_state().to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "unsupported".into()
    }
}

#[cfg(target_os = "macos")]
fn open_accessibility_settings() {
    let _ = std::process::Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

#[cfg(target_os = "macos")]
fn macos_accessibility_check() -> bool {
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

#[cfg(target_os = "macos")]
fn macos_prompt_accessibility_permission() -> Option<bool> {
    use std::ffi::c_void;
    use std::ptr;

    type CFAllocatorRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFIndex = isize;
    type CFStringRef = *const c_void;
    type CFTypeRef = *const c_void;

    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        static kCFBooleanTrue: CFTypeRef;

        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: CFIndex,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFRelease(value: CFTypeRef);
    }

    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt as *const c_void];
        let values = [kCFBooleanTrue];
        let options = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
        );

        if options.is_null() {
            return None;
        }

        let trusted = AXIsProcessTrustedWithOptions(options) != 0;
        CFRelease(options as CFTypeRef);
        Some(trusted)
    }
}

#[cfg(target_os = "macos")]
fn macos_microphone_permission_state() -> &'static str {
    use std::ffi::c_void;
    use std::mem;
    use std::ptr;

    type Id = *mut c_void;
    type Sel = *mut c_void;
    type CFAllocatorRef = *const c_void;
    type CFStringEncoding = u32;
    type CFStringRef = *const c_void;

    const K_CFSTRING_ENCODING_UTF8: CFStringEncoding = 0x0800_0100;

    extern "C" {
        fn CFStringCreateWithCString(
            alloc: CFAllocatorRef,
            c_str: *const std::ffi::c_char,
            encoding: CFStringEncoding,
        ) -> CFStringRef;
        fn CFRelease(value: CFStringRef);
        fn objc_getClass(name: *const std::ffi::c_char) -> Id;
        fn sel_registerName(name: *const std::ffi::c_char) -> Sel;
        fn objc_msgSend();
    }

    unsafe {
        let class = objc_getClass(b"AVCaptureDevice\0".as_ptr().cast());
        if class.is_null() {
            return "unknown";
        }

        let media_type = CFStringCreateWithCString(
            ptr::null(),
            b"soun\0".as_ptr().cast(),
            K_CFSTRING_ENCODING_UTF8,
        );
        if media_type.is_null() {
            return "unknown";
        }

        let selector = sel_registerName(b"authorizationStatusForMediaType:\0".as_ptr().cast());
        let msg_send: unsafe extern "C" fn(Id, Sel, CFStringRef) -> isize =
            mem::transmute(objc_msgSend as *const ());
        let status = msg_send(class, selector, media_type);
        CFRelease(media_type);

        match status {
            0 => "prompt",
            1 | 2 => "denied",
            3 => "granted",
            _ => "unknown",
        }
    }
}
