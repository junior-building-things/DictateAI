import SwiftUI
import UIKit

/// The keyboard: a dictation toolbar above system-styled keys. Geometry and
/// colors are measured from the iOS 27 system keyboard; touches are handled
/// by `KeyboardTouchView`, this view only draws.
struct KeyboardView: View {
    @ObservedObject var model: KeyboardModel
    @Environment(\.colorScheme) private var systemScheme

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            if model.showingEmoji {
                EmojiPanel(model: model, palette: palette)
                    .frame(height: KeyboardMetrics.keysHeight)
            } else {
                keys
            }
        }
        .frame(height: KeyboardMetrics.totalHeight)
    }

    private var palette: KeyPalette {
        let dark = model.context.appearance == .dark || (model.context.appearance != .light && systemScheme == .dark)
        return dark ? .dark : .light
    }

    // MARK: Keys

    private var keys: some View {
        GeometryReader { proxy in
            let layout = model.layout
            ZStack(alignment: .topLeading) {
                ForEach(layout.frames) { key in
                    KeyCap(key: key, model: model, palette: palette)
                        .frame(width: key.rect.width, height: key.rect.height)
                        .offset(x: key.rect.minX, y: key.rect.minY)
                }
                if let callout = model.callout {
                    Callout(key: callout, label: label(for: callout), palette: palette, width: proxy.size.width)
                }
                if let menu = model.accentMenu {
                    AccentMenuView(menu: menu, palette: palette, width: proxy.size.width)
                }
                KeyboardTouchLayer(model: model)
            }
            .onAppear { model.width = proxy.size.width }
            .onChange(of: proxy.size.width) { _, width in model.width = width }
        }
        .frame(height: KeyboardMetrics.keysHeight)
    }

    private func label(for key: KeyFrame) -> String {
        guard case .character(let c) = key.kind else { return "" }
        return model.layer == .letters && (model.shift || model.capsLock) ? c.uppercased() : c
    }

    // MARK: Dictation bar

    /// iOS adds ~17 pt of padding above a third-party keyboard, so lifting
    /// the bar's contents 6 pt (half of toolbarHeight − micSize) centers them between the panel's top edge
    /// and the first row of keys.
    private static let barLift: CGFloat = 12
    private static let micSize: CGFloat = 34

    /// Suggestions (or dictation status) on the left, the mic on the right.
    private var toolbar: some View {
        HStack(spacing: 0) {
            Group {
                if model.dictation == .idle {
                    suggestionRow
                } else {
                    Button(action: statusTapped) {
                        statusContent
                            .padding(.bottom, Self.barLift)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Button(action: model.micTapped) {
                micIcon
                    .padding(.bottom, Self.barLift)
                    // Centered over the delete key's column.
                    .frame(width: 2 * (KeyboardMetrics.sideMargin + 22.75), height: KeyboardMetrics.toolbarHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.dictation == .processing)
            .accessibilityLabel(model.dictation == .recording ? "Stop dictation" : "Dictate")
        }
        .padding(.leading, KeyboardMetrics.sideMargin)
        .frame(height: KeyboardMetrics.toolbarHeight)
    }

    private var suggestionRow: some View {
        HStack(spacing: 0) {
            ForEach(Array(model.suggestions.enumerated()), id: \.element) { index, suggestion in
                if index > 0 {
                    Rectangle().fill(palette.secondaryText.opacity(0.35)).frame(width: 1, height: 22)
                        .padding(.bottom, Self.barLift)
                }
                Button { model.applySuggestion(suggestion) } label: {
                    suggestionLabel(suggestion)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.horizontal, 4)
                        .padding(.bottom, Self.barLift)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func suggestionLabel(_ suggestion: KeyboardModel.Suggestion) -> Text {
        switch suggestion {
        case .typed(let word): Text("“\(word)”").font(.system(size: 16)).foregroundColor(palette.text)
        case .word(let word): Text(word).font(.system(size: 16)).foregroundColor(palette.text)
        case .emoji(let emoji): Text(emoji).font(.system(size: 24))
        }
    }

    /// The DictateAI app icon; red with a stop square while recording.
    private var micIcon: some View {
        let shape = RoundedRectangle(cornerRadius: Self.micSize * 0.225, style: .continuous)
        return ZStack {
            // A loose PNG, which SwiftUI's Image(_:) (asset catalogs only) can't load.
            Image(uiImage: UIImage(named: "DictationIcon") ?? UIImage()).resizable().interpolation(.high)
            switch model.dictation {
            case .recording:
                shape.fill(Color.red)
                Image(systemName: "stop.fill").font(.system(size: 13, weight: .bold))
            case .processing:
                shape.fill(Color.black.opacity(0.35))
                ProgressView().controlSize(.small).tint(.white)
            case .idle, .failed:
                EmptyView()
            }
        }
        .foregroundStyle(.white)
        .frame(width: Self.micSize, height: Self.micSize)
        .clipShape(shape)
    }

    @ViewBuilder private var statusContent: some View {
        switch model.dictation {
        case .idle:
            EmptyView()
        case .recording:
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let seconds = Int(context.date.timeIntervalSince(model.recordingStart))
                Text(String(format: "Listening %d:%02d · tap to finish", seconds / 60, seconds % 60))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.red)
            }
        case .processing:
            Text("Transcribing…").font(.system(size: 15)).foregroundStyle(palette.secondaryText)
        case .failed(let message):
            Text(message).font(.system(size: 12)).foregroundStyle(.red).lineLimit(1).minimumScaleFactor(0.8)
        }
    }

    /// Tapping the status finishes a recording or dismisses an error.
    private func statusTapped() {
        switch model.dictation {
        case .recording: model.micTapped()
        case .failed: model.dictation = .idle
        default: break
        }
    }
}

// MARK: - Palette

struct KeyPalette {
    let key: Color
    let pressedKey: Color
    let text: Color
    let secondaryText: Color
    let accent: Color

    /// Sampled from the system keyboard (light: white keys on the glass panel).
    static let light = KeyPalette(key: .white, pressedKey: Color(red: 0.82, green: 0.83, blue: 0.85),
                                  text: .black, secondaryText: .secondary,
                                  accent: Color(red: 0, green: 122 / 255, blue: 1))
    static let dark = KeyPalette(key: Color(white: 0.42), pressedKey: Color(white: 0.30),
                                 text: .white, secondaryText: Color(white: 0.75),
                                 accent: Color(red: 0, green: 122 / 255, blue: 1))
}

// MARK: - Key caps

private struct KeyCap: View {
    let key: KeyFrame
    @ObservedObject var model: KeyboardModel
    let palette: KeyPalette

    private var isPressed: Bool { model.pressed.contains(key.id) }

    var body: some View {
        RoundedRectangle(cornerRadius: KeyboardMetrics.cornerRadius, style: .continuous)
            .fill(fill)
            .overlay { content.opacity(model.trackpadActive ? 0 : 1) }
            // A character key under its pop-up hides, as on the system keyboard.
            .opacity(key.kind.isCharacter && (model.callout?.id == key.id || model.accentMenu?.key.id == key.id) ? 0 : 1)
    }

    private var fill: Color {
        if case .returnKey = key.kind, isBlueReturn {
            return model.context.returnEnabled ? palette.accent : palette.accent.opacity(0.4)
        }
        return isPressed && !key.kind.isCharacter ? palette.pressedKey : palette.key
    }

    private var isBlueReturn: Bool { model.context.returnKeyType != .default }

    @ViewBuilder private var content: some View {
        switch key.kind {
        case .character(let c):
            if let subtitle = key.subtitle {
                VStack(spacing: -2) {
                    Text(c).font(.system(size: 26))
                    Text(subtitle).font(.system(size: 10, weight: .semibold)).kerning(1.5)
                }
                .foregroundStyle(palette.text)
            } else {
                let shown = model.layer == .letters && (model.shift || model.capsLock) ? c.uppercased() : c
                Text(shown)
                    .font(.system(size: c.count > 1 ? 16 : 22))
                    .foregroundStyle(palette.text)
                    .offset(y: -1)
            }
        case .shift:
            symbol(model.capsLock ? "capslock.fill" : (model.shift ? "shift.fill" : "shift"))
        case .delete:
            symbol(isPressed ? "delete.left.fill" : "delete.left")
        case .space:
            EmptyView()
        case .globe:
            symbol("globe")
        case .emoji:
            symbol("face.smiling", size: 22, weight: .semibold)
        case .layer(let target):
            Text(target == .letters ? "ABC" : (target == .numbers ? "123" : "#+=")).font(.system(size: 17))
                .foregroundStyle(palette.text)
        case .returnKey:
            returnLabel
        }
    }

    private func symbol(_ name: String, size: CGFloat = 19, weight: Font.Weight = .regular) -> some View {
        Image(systemName: name).font(.system(size: size, weight: weight)).foregroundStyle(palette.text)
    }

    @ViewBuilder private var returnLabel: some View {
        let foreground = isBlueReturn ? Color.white : palette.text
        switch model.context.returnKeyType {
        case .default:
            Image(systemName: "return.left").font(.system(size: 19)).foregroundStyle(foreground)
        case .send:
            Image(systemName: "arrow.up").font(.system(size: 20, weight: .medium)).foregroundStyle(foreground)
        case .search, .google, .yahoo:
            Image(systemName: "magnifyingglass").font(.system(size: 19, weight: .medium)).foregroundStyle(foreground)
        default:
            Text(returnTitle).font(.system(size: 17)).foregroundStyle(foreground)
        }
    }

    private var returnTitle: String {
        switch model.context.returnKeyType {
        case .go: "go"
        case .join: "join"
        case .next: "next"
        case .route: "route"
        case .done: "done"
        case .continue: "continue"
        case .emergencyCall: "SOS"
        default: "return"
        }
    }
}

// MARK: - Pop-ups

/// The enlarged letter that rises out of a pressed key.
private struct Callout: View {
    let key: KeyFrame
    let label: String
    let palette: KeyPalette
    let width: CGFloat

    var body: some View {
        let r = key.rect
        let bubbleWidth = r.width + 24
        // Rises no higher than the toolbar, which is all the room there is.
        let bubbleHeight = r.height - 8
        let bubbleX = min(max(r.midX - bubbleWidth / 2, 1), width - bubbleWidth - 1)
        let bubble = CGRect(x: bubbleX, y: r.minY - bubbleHeight + 4, width: bubbleWidth, height: bubbleHeight)
        ZStack(alignment: .topLeading) {
            CalloutShape(key: r, bubble: bubble)
                .fill(palette.key)
                .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
            Text(label)
                .font(.system(size: 34))
                .foregroundStyle(palette.text)
                .frame(width: bubble.width, height: bubble.height)
                .offset(x: bubble.minX, y: bubble.minY)
        }
        .allowsHitTesting(false)
    }
}

private struct CalloutShape: Shape {
    let key: CGRect
    let bubble: CGRect

    func path(in _: CGRect) -> Path {
        let r = KeyboardMetrics.cornerRadius
        var path = Path(roundedRect: bubble, cornerRadius: r + 2, style: .continuous)
        // Neck joining the bubble to the key, narrowing with a smooth curve.
        var neck = Path()
        neck.move(to: CGPoint(x: bubble.minX + 2, y: bubble.maxY - r))
        neck.addCurve(to: CGPoint(x: key.minX, y: key.minY + r),
                      control1: CGPoint(x: bubble.minX + 2, y: bubble.maxY + 4),
                      control2: CGPoint(x: key.minX, y: key.minY))
        neck.addLine(to: CGPoint(x: key.minX, y: key.maxY - r))
        neck.addQuadCurve(to: CGPoint(x: key.minX + r, y: key.maxY), control: CGPoint(x: key.minX, y: key.maxY))
        neck.addLine(to: CGPoint(x: key.maxX - r, y: key.maxY))
        neck.addQuadCurve(to: CGPoint(x: key.maxX, y: key.maxY - r), control: CGPoint(x: key.maxX, y: key.maxY))
        neck.addLine(to: CGPoint(x: key.maxX, y: key.minY + r))
        neck.addCurve(to: CGPoint(x: bubble.maxX - 2, y: bubble.maxY - r),
                      control1: CGPoint(x: key.maxX, y: key.minY),
                      control2: CGPoint(x: bubble.maxX - 2, y: bubble.maxY + 4))
        neck.closeSubpath()
        path.addPath(neck)
        return path
    }
}

private struct AccentMenuView: View {
    let menu: KeyboardModel.AccentMenu
    let palette: KeyPalette
    let width: CGFloat

    var body: some View {
        let frame = AccentGeometry.menuFrame(menu, width: width)
        let options = AccentGeometry.optionFrames(menu, width: width)
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: KeyboardMetrics.cornerRadius + 2, style: .continuous)
                .fill(palette.key)
                .shadow(color: .black.opacity(0.25), radius: 4, y: 1)
                .frame(width: frame.width, height: frame.height)
                .offset(x: frame.minX, y: frame.minY)
            ForEach(menu.options.indices, id: \.self) { i in
                let selected = i == menu.selected
                Text(menu.options[i])
                    .font(.system(size: 26))
                    .foregroundStyle(selected ? .white : palette.text)
                    .frame(width: options[i].width, height: options[i].height)
                    .background(selected ? RoundedRectangle(cornerRadius: 7, style: .continuous).fill(palette.accent) : nil)
                    .offset(x: options[i].minX, y: options[i].minY)
            }
        }
        .allowsHitTesting(false)
    }
}
