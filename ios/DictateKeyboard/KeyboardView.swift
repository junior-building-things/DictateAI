import SwiftUI

/// A basic QWERTY keyboard in the system style, with a dictation button in
/// the top-right of a toolbar row — the Raycast layout. Phase 1 keeps typing
/// simple (no autocorrect, callouts or swipe typing).
struct KeyboardView: View {
    static let height: CGFloat = 270

    @ObservedObject var model: KeyboardModel
    @Environment(\.colorScheme) private var scheme

    private let letterRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map { $0.map(String.init) }
    private let symbolRows = ["1234567890", "-/:;()$&@\"", ".,?!'"].map { $0.map(String.init) }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            VStack(spacing: 11) {
                let rows = model.symbols ? symbolRows : letterRows
                row(rows[0])
                row(rows[1]).padding(.horizontal, model.symbols ? 0 : 18)
                HStack(spacing: 6) {
                    if model.symbols {
                        FunctionKey(label: "", width: 44) {}.opacity(0)
                    } else {
                        FunctionKey(systemImage: shiftIcon, width: 44, highlighted: model.shift) { model.toggleShift() }
                    }
                    Spacer(minLength: 4)
                    row(rows[2])
                    Spacer(minLength: 4)
                    DeleteKey { model.deleteBackward() }
                }
                HStack(spacing: 6) {
                    FunctionKey(label: model.symbols ? "ABC" : "123", width: 48) { model.symbols.toggle() }
                    if model.showsGlobeKey {
                        FunctionKey(systemImage: "globe", width: 42) { model.nextKeyboard() }
                    }
                    CharacterKey(label: "space", font: .system(size: 16)) { model.space() }
                    FunctionKey(label: "return", width: 92) { model.newline() }
                }
            }
            .padding(.horizontal, 3)
            .padding(.bottom, 4)
        }
        .frame(height: Self.height)
        .environment(\.keyboardScheme, scheme)
    }

    private var shiftIcon: String {
        model.capsLock ? "capslock.fill" : (model.shift ? "shift.fill" : "shift")
    }

    private func row(_ keys: [String]) -> some View {
        HStack(spacing: 6) {
            ForEach(keys, id: \.self) { key in
                let shown = (model.shift || model.capsLock) && !model.symbols ? key.uppercased() : key
                CharacterKey(label: shown) { model.type(key) }
            }
        }
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 8) {
            status
            Spacer(minLength: 0)
            Button(action: model.micTapped) {
                ZStack {
                    Circle().fill(micFill).frame(width: 34, height: 34)
                    if model.dictation == .processing {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: model.dictation == .recording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.dictation == .recording ? "Stop dictation" : "Dictate")
        }
        .padding(.horizontal, 10)
        .frame(height: 46)
    }

    @ViewBuilder private var status: some View {
        switch model.dictation {
        case .idle:
            EmptyView()
        case .recording:
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let seconds = Int(context.date.timeIntervalSince(model.recordingStart))
                Label(String(format: "Listening %d:%02d", seconds / 60, seconds % 60), systemImage: "waveform")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.red)
            }
        case .processing:
            Text("Transcribing…").font(.system(size: 14)).foregroundStyle(.secondary)
        case .failed(let message):
            Text(message).font(.system(size: 12)).foregroundStyle(.red).lineLimit(2)
        }
    }

    private var micFill: Color {
        switch model.dictation {
        case .recording: .red
        case .processing: .gray
        default: .accentColor
        }
    }
}

// MARK: - Keys

private struct KeyboardSchemeKey: EnvironmentKey { static let defaultValue: ColorScheme = .light }
private extension EnvironmentValues {
    var keyboardScheme: ColorScheme {
        get { self[KeyboardSchemeKey.self] }
        set { self[KeyboardSchemeKey.self] = newValue }
    }
}

private struct KeyFace: ViewModifier {
    @Environment(\.keyboardScheme) private var scheme
    let function: Bool
    let pressed: Bool

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, minHeight: 42, maxHeight: 42)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(fill)
                    .shadow(color: .black.opacity(0.3), radius: 0, x: 0, y: 1)
            )
            .foregroundStyle(scheme == .dark ? Color.white : Color.black)
    }

    private var fill: Color {
        let light = scheme == .dark ? Color(white: 0.42) : .white
        let dark = scheme == .dark ? Color(white: 0.27) : Color(red: 0.67, green: 0.69, blue: 0.73)
        return function != pressed ? dark : light
    }
}

private struct PressStyle: ButtonStyle {
    let function: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(KeyFace(function: function, pressed: configuration.isPressed))
    }
}

private struct CharacterKey: View {
    let label: String
    var font: Font = .system(size: 23)
    let action: () -> Void

    var body: some View {
        Button(action: action) { Text(label).font(font) }
            .buttonStyle(PressStyle(function: false))
    }
}

private struct FunctionKey: View {
    var label: String = ""
    var systemImage: String? = nil
    let width: CGFloat
    var highlighted = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 17)) }
                else { Text(label).font(.system(size: 16)) }
            }
        }
        .buttonStyle(PressStyle(function: !highlighted))
        .frame(width: width)
    }
}

/// Deletes once on tap and repeats while held.
private struct DeleteKey: View {
    let action: () -> Void
    @State private var timer: Timer?

    var body: some View {
        Image(systemName: "delete.left").font(.system(size: 17))
            .modifier(KeyFace(function: true, pressed: timer != nil))
            .frame(width: 44)
            .contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
                if pressing {
                    action()
                    timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in action() }
                    timer?.fireDate = Date().addingTimeInterval(0.45)
                } else {
                    timer?.invalidate()
                    timer = nil
                }
            }, perform: {})
    }
}
