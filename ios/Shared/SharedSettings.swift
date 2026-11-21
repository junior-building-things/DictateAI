import Foundation
import Security

/// Settings shared between the app (where you enter them) and the keyboard
/// (where they're used). API keys live in the shared keychain group; plain
/// settings in the App Group's defaults.
enum SharedSettings {
    static let appGroup = "group.com.dictateai.shared"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    // Same setting names as the Mac app's SQLite keys, for the sync later.
    static let groqKeyName = "speech_groq_api_key"
    static let geminiKeyName = "gemini_api_key"

    /// Spoken language passed to the speech model, e.g. "en".
    static var language: String {
        get { defaults.string(forKey: "language") ?? "en" }
        set { defaults.set(newValue, forKey: "language") }
    }

    /// Light haptic on each key press (needs Full Access). Off by default,
    /// like the system keyboard's Haptic Feedback setting.
    static var keyHaptics: Bool {
        get { defaults.bool(forKey: "key_haptics") }
        set { defaults.set(newValue, forKey: "key_haptics") }
    }

    static var groqKey: String {
        get { Keychain.read(groqKeyName) ?? "" }
        set { Keychain.write(groqKeyName, newValue) }
    }

    static var geminiKey: String {
        get { Keychain.read(geminiKeyName) ?? "" }
        set { Keychain.write(geminiKeyName, newValue) }
    }
}

/// Generic-password items in the keychain group both targets list first in
/// `keychain-access-groups`, so no explicit access group is needed here.
enum Keychain {
    private static let service = "com.dictateai.ios"

    static func read(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ account: String, _ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var item = base
        item[kSecValueData as String] = Data(value.utf8)
        // The keyboard reads keys while the phone is unlocked and in use.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }
}
