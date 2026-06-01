use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tauri::{Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult};

/// Type `text` into the focused field at enigo's default mac_delay (12 ms).
/// Used for fast-path injection like the 🎙️/✏️ placeholders where
/// reliability isn't a concern (they get overwritten or backspaced moments
/// later anyway).
pub fn insert_text(text: &str) -> AppResult<()> {
    insert_text_with_delay(text, 12)
}

/// Type `text` at a deliberately slow 100 ms/key. Used only for the final
/// rewrite paste — slow enough that apps with their own IME handling
/// (Electron, certain text editors) don't drop characters.
pub fn insert_text_slow(text: &str) -> AppResult<()> {
    insert_text_with_delay(text, 100)
}

fn insert_text_with_delay(text: &str, mac_delay_ms: u32) -> AppResult<()> {
    if text.is_empty() {
        return Ok(());
    }

    if !check_accessibility() {
        log::warn!("Accessibility permission not granted — skipping auto-paste");
        return Err(AppError::Clipboard(
            "Accessibility permission not granted. Go to System Settings → Privacy & Security → Accessibility and add this app.".into()
        ));
    }

    let typed_settings = Settings {
        mac_delay: mac_delay_ms,
        ..Settings::default()
    };
    let mut enigo = Enigo::new(&typed_settings)
        .map_err(|e| AppError::Clipboard(format!("Failed to create input simulator: {}", e)))?;
    enigo
        .text(text)
        .map_err(|e| AppError::Clipboard(format!("Failed to insert text: {}", e)))?;
    log::info!(
        "Text inserted directly into focused field ({} chars, mac_delay={}ms)",
        text.len(),
        mac_delay_ms,
    );
    Ok(())
}

/// Highlight the last `len` chars (presumed to be a placeholder we typed
/// earlier) and replace them with `replacement`. If `replacement` is empty,
/// the placeholder is just deleted. The replacement is typed via the slow
/// path (`insert_text_slow`) since this is the user-visible final paste.
pub fn replace_placeholder(len: usize, replacement: &str) -> AppResult<()> {
    replace_placeholder_inner(len, replacement, /* slow_typing = */ true)
}

/// Fast variant of [`replace_placeholder`] that types the replacement at the
/// normal 12 ms delay instead of the slow final-paste delay. Used for the
/// 🎙️ Listening… → ✏️ Rewriting… swap.
pub fn replace_placeholder_fast(len: usize, replacement: &str) -> AppResult<()> {
    replace_placeholder_inner(len, replacement, /* slow_typing = */ false)
}

fn replace_placeholder_inner(len: usize, replacement: &str, slow_typing: bool) -> AppResult<()> {
    // Remove the placeholder with Backspace×N rather than a Shift+Arrow
    // selection. A synthesized Shift isn't always delivered by the macOS
    // event tap before we start typing (and can merge with a lingering
    // trigger modifier), so selection-based replacement intermittently failed
    // to select — the replacement landed *next to* the placeholder, leaving
    // e.g. "Rewriting..." in the final output. Backspaces are modifier-free
    // and deterministic; mac_delay: 1 keeps the deletion near-instant.
    if len > 0 {
        let fast_settings = Settings {
            mac_delay: 1,
            ..Settings::default()
        };
        let mut enigo = Enigo::new(&fast_settings)
            .map_err(|e| AppError::Clipboard(format!("Failed to create input simulator: {}", e)))?;
        for _ in 0..len {
            enigo
                .key(Key::Backspace, Direction::Click)
                .map_err(|e| AppError::Clipboard(format!("Backspace failed: {}", e)))?;
        }
        drop(enigo);
    }

    if replacement.is_empty() {
        log::info!("Deleted {}-char placeholder", len);
        return Ok(());
    }

    // Brief settle so the Backspaces fully propagate before we type, so the
    // replacement doesn't race the deletion.
    if len > 0 {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    if slow_typing {
        insert_text_slow(replacement)?;
    } else {
        insert_text(replacement)?;
    }
    log::info!(
        "Replaced {}-char placeholder with {} chars (slow_typing={})",
        len,
        replacement.len(),
        slow_typing,
    );
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
