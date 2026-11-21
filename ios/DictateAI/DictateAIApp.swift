import AVFoundation
import SwiftUI

@main
struct DictateAIApp: App {
    var body: some Scene {
        WindowGroup { SetupView() }
    }
}

/// Phase 1: the app only sets the keyboard up. The keyboard records,
/// transcribes and inserts text on its own.
struct SetupView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var micPermission = AVAudioApplication.shared.recordPermission
    @State private var groqKey = SharedSettings.groqKey
    @State private var geminiKey = SharedSettings.geminiKey
    @State private var language = SharedSettings.language
    @State private var tryIt = ""
    @State private var keyHaptics = SharedSettings.keyHaptics

    private let languages = [("en", "English"), ("sv", "Svenska"), ("fi", "Suomi"), ("zh", "中文")]

    var body: some View {
        NavigationStack {
            Form {
                // At the top so the keyboard never covers it.
                Section("Try it") {
                    TextField("Switch to the DictateAI keyboard and tap the mic", text: $tryIt, axis: .vertical)
                        .lineLimit(3...8)
                }

                Section {
                    Button("Open DictateAI in Settings") {
                        UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
                    }
                } header: {
                    Text("1. Add the keyboard")
                } footer: {
                    Text("Tap Keyboards, turn on DictateAI and Allow Full Access. Full Access lets the keyboard use the microphone and reach the speech and rewrite services.")
                }

                Section {
                    switch micPermission {
                    case .granted:
                        Label("Microphone allowed", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case .denied:
                        Button("Microphone denied — open Settings") {
                            UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
                        }
                    default:
                        Button("Allow microphone") {
                            AVAudioApplication.requestRecordPermission { _ in
                                DispatchQueue.main.async { micPermission = AVAudioApplication.shared.recordPermission }
                            }
                        }
                    }
                } header: {
                    Text("2. Microphone")
                } footer: {
                    Text("Keyboards can't ask for the microphone themselves, so the app asks once for both.")
                }

                Section {
                    SecureField("Groq API key (speech)", text: $groqKey)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: groqKey) { _, value in SharedSettings.groqKey = value.trimmingCharacters(in: .whitespaces) }
                    SecureField("Gemini API key (rewrite)", text: $geminiKey)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: geminiKey) { _, value in SharedSettings.geminiKey = value.trimmingCharacters(in: .whitespaces) }
                    Picker("Spoken language", selection: $language) {
                        ForEach(languages, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .onChange(of: language) { _, value in SharedSettings.language = value }
                    Toggle("Haptic feedback on keys", isOn: $keyHaptics)
                        .onChange(of: keyHaptics) { _, value in SharedSettings.keyHaptics = value }
                } header: {
                    Text("3. API keys")
                } footer: {
                    Text("Speech uses Groq whisper-large-v3-turbo and cleanup uses Gemini 3.5 Flash-Lite, like the Mac app's defaults. Without a Gemini key the raw transcript is inserted.")
                }

            }
            .navigationTitle("DictateAI")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { micPermission = AVAudioApplication.shared.recordPermission }
        }
    }
}
