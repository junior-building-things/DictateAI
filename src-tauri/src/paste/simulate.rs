use std::thread;
use std::time::Duration;

use crate::error::{AppError, AppResult};

pub fn paste() -> AppResult<()> {
    // Check accessibility permission first on macOS
    if !check_accessibility() {
        log::warn!("Accessibility permission not granted — skipping auto-paste");
        return Err(AppError::Clipboard(
            "Accessibility permission not granted. Go to System Settings → Privacy & Security → Accessibility and add this app. Text is on clipboard — paste manually with Cmd+V.".into()
        ));
    }

    // Small delay to ensure clipboard is updated
    thread::sleep(Duration::from_millis(100));

    #[cfg(target_os = "macos")]
    {
        macos_paste()
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Fallback for non-macOS: use enigo
        enigo_paste()
    }
}

/// Simulate Cmd+V on macOS using CGEvent API directly.
/// Unlike enigo's HIToolbox approach, CGEvent works from any thread.
#[cfg(target_os = "macos")]
fn macos_paste() -> AppResult<()> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| AppError::Clipboard("Failed to create CGEventSource".into()))?;

    // Key code 9 = 'v' on macOS
    let v_keycode: CGKeyCode = 9;

    // Create key down event for 'v' with Cmd modifier
    let key_down = CGEvent::new_keyboard_event(source.clone(), v_keycode, true)
        .map_err(|_| AppError::Clipboard("Failed to create key down event".into()))?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // Create key up event for 'v' with Cmd modifier
    let key_up = CGEvent::new_keyboard_event(source, v_keycode, false)
        .map_err(|_| AppError::Clipboard("Failed to create key up event".into()))?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Post the events
    key_down.post(core_graphics::event::CGEventTapLocation::HID);
    key_up.post(core_graphics::event::CGEventTapLocation::HID);

    log::info!("Paste simulated (Cmd+V via CGEvent)");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn enigo_paste() -> AppResult<()> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| AppError::Clipboard(format!("Failed to create enigo: {}", e)))?;

    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| AppError::Clipboard(format!("Failed to press Meta: {}", e)))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| AppError::Clipboard(format!("Failed to press V: {}", e)))?;
    enigo
        .key(Key::Meta, Direction::Release)
        .map_err(|e| AppError::Clipboard(format!("Failed to release Meta: {}", e)))?;

    log::info!("Paste simulated (Cmd+V via enigo)");
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
        let _ = std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn();
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
