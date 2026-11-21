import AudioToolbox
import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var model = KeyboardModel(controller: self)

    override func viewDidLoad() {
        super.viewDidLoad()
        // Our own input view so `playInputClick()` follows the user's
        // Keyboard Clicks setting, like the system keyboard.
        let input = ClickingInputView(frame: .zero, inputViewStyle: .keyboard)
        input.allowsSelfSizing = true
        inputView = input

        let host = UIHostingController(rootView: KeyboardView(model: model))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        input.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: input.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: input.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: input.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: input.bottomAnchor),
            input.heightAnchor.constraint(equalToConstant: KeyboardMetrics.totalHeight),
        ])
        host.didMove(toParent: self)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        model.showsGlobeKey = needsInputModeSwitchKey
        model.hasFullAccess = hasFullAccess
        model.refreshContext(resetLayer: true)
    }

    override func textDidChange(_ textInput: UITextInput?) {
        model.refreshContext(resetLayer: false)
    }
}

final class ClickingInputView: UIInputView, UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}

/// Keyboard state and actions; the views render it and forward touches.
@MainActor
final class KeyboardModel: ObservableObject {
    enum Dictation: Equatable { case idle, recording, processing, failed(String) }

    struct AccentMenu: Equatable {
        let key: KeyFrame
        let options: [String]
        var selected: Int
    }

    /// What the focused text field asks for.
    struct FieldContext: Equatable {
        var keyboardType: UIKeyboardType = .default
        var returnKeyType: UIReturnKeyType = .default
        var appearance: UIKeyboardAppearance = .default
        var autocapitalization: UITextAutocapitalizationType = .sentences
        var smartQuotes = true
        var smartDashes = true
        var returnEnabled = true
    }

    // Dictation
    @Published var dictation: Dictation = .idle
    @Published var recordingStart = Date()

    // Typing
    @Published var layer: KeyboardLayer = .letters
    @Published var shift = false
    @Published var capsLock = false
    @Published var pressed: Set<Int> = []
    @Published var callout: KeyFrame?
    @Published var accentMenu: AccentMenu?
    @Published var trackpadActive = false
    @Published var showingEmoji = false
    @Published var context = FieldContext()
    @Published var width: CGFloat = 402
    @Published var showsGlobeKey = true
    @Published var hasFullAccess = true
    @Published var suggestions: [Suggestion] = []

    enum Suggestion: Hashable {
        /// The word as typed, shown in quotes; tapping keeps it.
        case typed(String)
        case word(String)
        case emoji(String)
    }

    var layout: KeyboardLayout {
        KeyboardLayout.make(width: width, layer: layer, type: context.keyboardType, showsGlobe: showsGlobeKey)
    }

    private weak var controller: KeyboardViewController?
    private let recorder = Recorder()
    private let haptics = UIImpactFeedbackGenerator(style: .light)
    private var lastShiftTap = Date.distantPast
    private let checker = UITextChecker()
    /// The last autocorrection, undone by pressing delete right after it.
    private var lastCorrection: (original: String, corrected: String, suffix: String)?
    private var proxy: UITextDocumentProxy? { controller?.textDocumentProxy }

    init(controller: KeyboardViewController) {
        self.controller = controller
        recorder.onLimitReached = { [weak self] in
            Task { @MainActor in self?.stopDictation() }
        }
    }

    // MARK: Field context

    func refreshContext(resetLayer: Bool) {
        guard let proxy else { return }
        var c = FieldContext()
        c.keyboardType = proxy.keyboardType ?? .default
        c.returnKeyType = proxy.returnKeyType ?? .default
        c.appearance = proxy.keyboardAppearance ?? .default
        c.autocapitalization = proxy.autocapitalizationType ?? .sentences
        c.smartQuotes = proxy.smartQuotesType != .no
        c.smartDashes = proxy.smartDashesType != .no
        c.returnEnabled = !(proxy.enablesReturnKeyAutomatically ?? false) || proxy.hasText
        if c != context { context = c }
        if resetLayer {
            layer = c.keyboardType == .numbersAndPunctuation ? .numbers : .letters
            showingEmoji = false
        }
        updateAutoShift()
    }

    /// Shift follows the field's autocapitalization, like the system keyboard.
    func updateAutoShift() {
        updateSuggestions()
        guard !capsLock else { return }
        let before = proxy?.documentContextBeforeInput ?? ""
        let trimmed = before.trimmingCharacters(in: .whitespaces)
        switch context.autocapitalization {
        case .none:
            shift = false
        case .allCharacters:
            shift = true
        case .words:
            shift = before.isEmpty || before.last?.isWhitespace == true
        default:
            let endsSentence = [".", "!", "?"].contains(trimmed.last.map(String.init) ?? "")
            shift = trimmed.isEmpty || before.last == "\n" || (before.hasSuffix(" ") && endsSentence)
        }
    }

    // MARK: Key events (from KeyboardTouchView)

    func keyDown(_ key: KeyFrame) {
        feedback()
        if case .failed = dictation { dictation = .idle }
        if key.kind != .delete { lastCorrection = nil }
        pressed.insert(key.id)
        switch key.kind {
        case .character: callout = key
        case .shift: toggleShift()
        case .delete: deleteBackward()
        default: break
        }
    }

    /// Finger slid from one character key onto another before lifting.
    func keyMoved(from old: KeyFrame, to new: KeyFrame) {
        pressed.remove(old.id)
        pressed.insert(new.id)
        callout = new
    }

    func keyUp(_ key: KeyFrame) {
        release(key)
        switch key.kind {
        case .character(let text): insertCharacter(text)
        case .space: space()
        case .returnKey:
            guard context.returnEnabled else { return }
            proxy?.insertText("\n")
            updateAutoShift()
        case .layer(let target): layer = target
        case .emoji: showingEmoji = true
        default: break
        }
    }

    func release(_ key: KeyFrame) {
        pressed.remove(key.id)
        if callout?.id == key.id { callout = nil }
    }

    func cancelAll() {
        pressed.removeAll()
        callout = nil
        accentMenu = nil
        trackpadActive = false
    }

    // Accents

    /// Opens the press-and-hold menu; returns false when the key has none.
    func showAccents(for key: KeyFrame) -> Bool {
        guard case .character(let c) = key.kind else { return false }
        var options = Alternates.options(for: c)
        guard !options.isEmpty else { return false }
        if layer == .letters && (shift || capsLock) { options = options.map { $0.uppercased() } }
        callout = nil
        accentMenu = AccentMenu(key: key, options: options, selected: 0)
        return true
    }

    func selectAccent(atX x: CGFloat) {
        guard var menu = accentMenu else { return }
        let frames = AccentGeometry.optionFrames(menu, width: width)
        if let index = frames.firstIndex(where: { x < $0.maxX }) ?? (frames.isEmpty ? nil : frames.count - 1),
           index != menu.selected {
            menu.selected = index
            accentMenu = menu
        }
    }

    func commitAccent() {
        guard let menu = accentMenu else { return }
        pressed.remove(menu.key.id)
        accentMenu = nil
        insertText(menu.options[menu.selected])
    }

    // Space-bar trackpad

    func setTrackpad(_ active: Bool) {
        trackpadActive = active
        if active { feedback() }
    }

    func moveCursor(by offset: Int) {
        lastCorrection = nil
        proxy?.adjustTextPosition(byCharacterOffset: offset)
        updateSuggestions()
    }

    // MARK: Autocorrect

    /// Replaces a misspelled word before the cursor with the closest of
    /// iOS's spelling guesses, as the user finishes it with space or
    /// punctuation. Returns what changed so delete can undo it.
    private func autocorrectWord() -> (original: String, fix: String)? {
        guard let proxy, proxy.autocorrectionType != .no, proxy.isSecureTextEntry != true,
              ![.emailAddress, .URL].contains(context.keyboardType), !context.keyboardType.isNumberPad
        else { return nil }
        let before = proxy.documentContextBeforeInput ?? ""
        let word = String(before.reversed().prefix { $0.isLetter || $0 == "'" || $0 == "’" }.reversed())
        guard let fix = correction(for: word), fix != word else { return nil }
        for _ in word { proxy.deleteBackward() }
        proxy.insertText(fix)
        return (word, fix)
    }

    private func correction(for word: String) -> String? {
        if word == "i" { return "I" }
        // Skip short words, acronyms, and words the user has kept by undoing.
        guard word.count >= 2, word != word.uppercased(), !UITextChecker.hasLearnedWord(word) else { return nil }
        let ns = word as NSString
        let range = NSRange(location: 0, length: ns.length)
        let language = Self.checkerLanguage
        guard checker.rangeOfMisspelledWord(in: word, range: range, startingAt: 0, wrap: false,
                                            language: language).location != NSNotFound
        else { return nil }
        // Closest guess wins (ties keep iOS's order); far-off guesses are
        // more likely wrong than the typo, so leave the word alone.
        let limit = word.count <= 3 ? 1 : 2
        let lower = word.lowercased()
        let best = (checker.guesses(forWordRange: range, in: word, language: language) ?? [])
            .map { ($0, Self.editDistance(lower, $0.lowercased())) }
            .filter { $0.1 <= limit }
            .min { $0.1 < $1.1 }?.0
        guard var fix = best else { return nil }
        if context.smartQuotes { fix = fix.replacingOccurrences(of: "'", with: "’") }
        if word.first?.isUppercase == true { fix = fix.prefix(1).uppercased() + fix.dropFirst() }
        return fix
    }

    /// Edits (insert, delete, substitute, swap two neighbors) between two words.
    private static func editDistance(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        guard !a.isEmpty, !b.isEmpty else { return max(a.count, b.count) }
        var d = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in 0...a.count { d[i][0] = i }
        for j in 0...b.count { d[0][j] = j }
        for i in 1...a.count {
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] {
                    d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
                }
            }
        }
        return d[a.count][b.count]
    }

    private static let checkerLanguage: String = {
        let wanted = SharedSettings.language
        return UITextChecker.availableLanguages.first { $0 == wanted || $0.hasPrefix(wanted + "_") } ?? "en_US"
    }()

    // MARK: Suggestions

    /// While a word is being typed: the word in quotes, then the correction
    /// or completions, with a fitting emoji in the last slot when there is
    /// one. Between words: three emoji for the last word.
    private func updateSuggestions() {
        let list = context.keyboardType.isNumberPad ? [] : makeSuggestions()
        if list != suggestions { suggestions = list }
    }

    private func makeSuggestions() -> [Suggestion] {
        let before = proxy?.documentContextBeforeInput ?? ""
        let word = String(before.reversed().prefix { $0.isLetter || $0 == "'" || $0 == "’" }.reversed())
        guard !word.isEmpty else {
            let trimmed = before.trimmingCharacters(in: .whitespaces)
            let last = String(trimmed.reversed().prefix { $0.isLetter }.reversed())
            return EmojiData.suggestions(for: last).map(Suggestion.emoji)
        }
        let emoji = EmojiData.matches(for: word).first
        let words = wordCandidates(for: word).prefix(emoji == nil ? 2 : 1)
        guard !words.isEmpty || emoji != nil else { return [] }
        return [.typed(word)] + words.map(Suggestion.word) + (emoji.map { [Suggestion.emoji($0)] } ?? [])
    }

    /// What autocorrect would pick first, then completions and spelling guesses.
    private func wordCandidates(for word: String) -> [String] {
        let ns = word as NSString
        let range = NSRange(location: 0, length: ns.length)
        let language = Self.checkerLanguage
        let completions = checker.completions(forPartialWordRange: range, in: word, language: language) ?? []
        let guesses = checker.guesses(forWordRange: range, in: word, language: language) ?? []
        var seen: Set<String> = [word.lowercased()]
        return ([correction(for: word)].compactMap { $0 } + completions + guesses)
            .map { matchCase($0, to: word) }
            .filter { seen.insert($0.lowercased()).inserted }
    }

    private func matchCase(_ candidate: String, to word: String) -> String {
        if word.count > 1 && word == word.uppercased() { return candidate.uppercased() }
        if word.first?.isUppercase == true { return candidate.prefix(1).uppercased() + candidate.dropFirst() }
        return candidate
    }

    func applySuggestion(_ suggestion: Suggestion) {
        switch suggestion {
        case .emoji(let emoji):
            insertSuggestedEmoji(emoji)
            return
        case .typed(let word):
            feedback()
            // Keeping the word as typed also stops autocorrect changing it.
            UITextChecker.learnWord(word)
            proxy?.insertText(" ")
        case .word(let replacement):
            feedback()
            let before = proxy?.documentContextBeforeInput ?? ""
            let typed = before.reversed().prefix { $0.isLetter || $0 == "'" || $0 == "’" }
            for _ in typed { proxy?.deleteBackward() }
            proxy?.insertText(replacement + " ")
        }
        lastCorrection = nil
        if shift && !capsLock { shift = false }
        updateAutoShift()
    }

    /// Adds the emoji after the word rather than replacing it.
    func insertSuggestedEmoji(_ emoji: String) {
        feedback()
        lastCorrection = nil
        let before = proxy?.documentContextBeforeInput ?? ""
        let needsSpace = before.last.map { !$0.isWhitespace } ?? false
        proxy?.insertText(needsSpace ? " " + emoji : emoji)
        EmojiData.recordRecent(emoji)
        if shift && !capsLock { shift = false }
        updateAutoShift()
    }

    // MARK: Typing

    private func insertCharacter(_ c: String) {
        let corrected = [".", ",", "!", "?"].contains(c) ? autocorrectWord() : nil
        var text = layer == .letters && (shift || capsLock) ? c.uppercased() : c
        let before = proxy?.documentContextBeforeInput ?? ""
        if context.smartQuotes && (c == "\"" || c == "'") {
            let opening = before.last.map { $0.isWhitespace || "([{“‘".contains($0) } ?? true
            text = c == "\"" ? (opening ? "“" : "”") : (opening ? "‘" : "’")
        }
        if context.smartDashes && c == "-" && before.hasSuffix("-") {
            proxy?.deleteBackward()
            text = "—"
        }
        insertText(text)
        if let corrected { lastCorrection = (corrected.original, corrected.fix, text) }
        if layer != .letters && c == "'" { layer = .letters }
    }

    private func insertText(_ text: String) {
        proxy?.insertText(text)
        if shift && !capsLock { shift = false }
        updateAutoShift()
    }

    private func space() {
        let corrected = autocorrectWord()
        // Double-space inserts a period, like the system keyboard.
        if let before = proxy?.documentContextBeforeInput, before.hasSuffix(" "),
           let previous = before.dropLast().last, previous.isLetter || previous.isNumber {
            proxy?.deleteBackward()
            proxy?.insertText(". ")
        } else {
            proxy?.insertText(" ")
        }
        if let corrected { lastCorrection = (corrected.original, corrected.fix, " ") }
        if layer != .letters { layer = .letters }
        updateAutoShift()
    }

    func deleteBackward() {
        if let last = lastCorrection, let proxy,
           (proxy.documentContextBeforeInput ?? "").hasSuffix(last.corrected + last.suffix) {
            // Undo: put back what was typed, and stop correcting that word.
            lastCorrection = nil
            for _ in 0..<(last.corrected.count + last.suffix.count) { proxy.deleteBackward() }
            proxy.insertText(last.original)
            UITextChecker.learnWord(last.original)
            updateAutoShift()
            return
        }
        lastCorrection = nil
        proxy?.deleteBackward()
        updateAutoShift()
    }

    /// Held delete speeds up to whole words, like the system keyboard.
    func deleteWord() {
        guard let proxy else { return }
        var before = proxy.documentContextBeforeInput ?? ""
        var count = 0
        while let last = before.last, last.isWhitespace { before.removeLast(); count += 1 }
        while let last = before.last, !last.isWhitespace { before.removeLast(); count += 1 }
        for _ in 0..<max(count, 1) { proxy.deleteBackward() }
        updateAutoShift()
    }

    func insertEmoji(_ emoji: String) {
        feedback()
        proxy?.insertText(emoji)
        EmojiData.recordRecent(emoji)
        updateAutoShift()
    }

    func closeEmoji() { showingEmoji = false }

    /// Tap toggles Shift; a quick second tap locks Caps.
    private func toggleShift() {
        let now = Date()
        if capsLock {
            capsLock = false
            shift = false
        } else if shift && now.timeIntervalSince(lastShiftTap) < 0.35 {
            capsLock = true
        } else {
            shift.toggle()
        }
        lastShiftTap = now
    }

    func advanceKeyboard(from view: UIView, with event: UIEvent?) {
        guard let event else { return }
        controller?.handleInputModeList(from: view, with: event)
    }

    private func feedback() {
        UIDevice.current.playInputClick()
        if hasFullAccess && SharedSettings.keyHaptics { haptics.impactOccurred() }
    }

    // MARK: Dictation

    func micTapped() {
        switch dictation {
        case .recording: stopDictation()
        case .processing: break
        case .idle, .failed: startDictation()
        }
    }

    private func startDictation() {
        guard hasFullAccess else {
            dictation = .failed("Turn on Allow Full Access for DictateAI in Settings.")
            return
        }
        do {
            try recorder.start()
            recordingStart = Date()
            dictation = .recording
        } catch {
            dictation = .failed(error.localizedDescription)
        }
    }

    private func stopDictation() {
        guard dictation == .recording else { return }
        let wav = recorder.stop()
        dictation = .processing
        Task {
            do {
                let text = try await Pipeline.run(wav: wav)
                insertDictation(text)
                dictation = .idle
            } catch {
                dictation = .failed(error.localizedDescription)
            }
        }
    }

    /// Adds a separating space when the cursor sits right after a word.
    private func insertDictation(_ text: String) {
        guard !text.isEmpty else { return }
        lastCorrection = nil
        let before = proxy?.documentContextBeforeInput ?? ""
        let needsSpace = before.last.map { !$0.isWhitespace } ?? false
        proxy?.insertText(needsSpace ? " " + text : text)
        updateAutoShift()
    }
}

/// Where the press-and-hold options sit, shared by drawing and touch handling.
enum AccentGeometry {
    static func optionWidth(_ key: KeyFrame) -> CGFloat { key.rect.width + 4 }

    static func menuFrame(_ menu: KeyboardModel.AccentMenu, width: CGFloat) -> CGRect {
        let w = optionWidth(menu.key) * CGFloat(menu.options.count) + 8
        // Overlaps the key's top a little so it fits in the toolbar's height.
        let h = menu.key.rect.height - 4
        var x = menu.key.rect.minX - 4
        x = min(max(x, 2), width - w - 2)
        return CGRect(x: x, y: menu.key.rect.minY - h + 4, width: w, height: h)
    }

    static func optionFrames(_ menu: KeyboardModel.AccentMenu, width: CGFloat) -> [CGRect] {
        let frame = menuFrame(menu, width: width)
        let w = optionWidth(menu.key)
        return menu.options.indices.map {
            CGRect(x: frame.minX + 4 + CGFloat($0) * w, y: frame.minY + 3, width: w, height: frame.height - 6)
        }
    }
}
