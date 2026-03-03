#!/bin/bash
# Run this script directly in Terminal.app to grant microphone + accessibility permissions.
# macOS will show permission prompts that you need to click "Allow".

echo "=== DictateAI Permission Setup ==="
echo ""
echo "Step 1: Checking microphone permission..."
echo ""

# Compile and run a small Swift helper that triggers the macOS microphone prompt
cat << 'SWIFT' > /tmp/stt_mic_check.swift
import AVFoundation
import Foundation

switch AVCaptureDevice.authorizationStatus(for: .audio) {
case .authorized:
    print("✅ Microphone: AUTHORIZED")
case .denied:
    print("❌ Microphone: DENIED")
    print("   → Go to System Settings → Privacy & Security → Microphone")
    print("   → Find 'Terminal' (or your terminal app) and toggle it ON")
case .restricted:
    print("❌ Microphone: RESTRICTED by system policy")
case .notDetermined:
    print("⏳ Requesting microphone access — look for a macOS popup dialog...")
    let semaphore = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        if granted {
            print("✅ Microphone: GRANTED!")
        } else {
            print("❌ Microphone: You clicked Deny. Please go to System Settings → Privacy & Security → Microphone and enable it.")
        }
        semaphore.signal()
    }
    semaphore.wait()
@unknown default:
    print("Unknown microphone status")
}
SWIFT

swiftc /tmp/stt_mic_check.swift -o /tmp/stt_mic_check 2>/dev/null && /tmp/stt_mic_check

echo ""
echo "Step 2: Accessibility permission (for auto-paste)..."
echo "   → Go to System Settings → Privacy & Security → Accessibility"
echo "   → Click the toggle for your terminal app (Terminal, iTerm2, etc.)"
echo "   → If it's not listed, you may need to use the + button to add it"
echo ""
echo "Step 3: After granting permissions, restart the app with:"
echo "   cd $(pwd) && npx tauri dev"
echo ""
