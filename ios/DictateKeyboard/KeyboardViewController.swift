import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var model = KeyboardModel(controller: self)

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: KeyboardView(model: model))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            view.heightAnchor.constraint(equalToConstant: KeyboardView.height),
        ])
        host.didMove(toParent: self)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        model.showsGlobeKey = needsInputModeSwitchKey
        model.hasFullAccess = hasFullAccess
        model.updateAutoShift()
    }

    override func textDidChange(_ textInput: UITextInput?) {
        model.updateAutoShift()
    }
}

/// Keyboard state and actions; the SwiftUI view only renders it.
@MainActor
final class KeyboardModel: ObservableObject {
    enum Dictation: Equatable { case idle, recording, processing, failed(String) }

    @Published var dictation: Dictation = .idle
    @Published var shift = false
    @Published var capsLock = false
    @Published var symbols = false
    @Published var showsGlobeKey = true
    @Published var hasFullAccess = true
    @Published var recordingStart = Date()

    private weak var controller: KeyboardViewController?
    private let recorder = Recorder()
    private var proxy: UITextDocumentProxy? { controller?.textDocumentProxy }

    init(controller: KeyboardViewController) {
        self.controller = controller
        recorder.onLimitReached = { [weak self] in
            Task { @MainActor in self?.stopDictation() }
        }
    }

    // MARK: Typing

    func type(_ key: String) {
        let upper = shift || capsLock
        proxy?.insertText(upper ? key.uppercased() : key)
        if shift && !capsLock { shift = false }
    }

    func space() {
        // Double-space inserts a period, like the system keyboard.
        if proxy?.documentContextBeforeInput?.hasSuffix(" ") == true,
           let before = proxy?.documentContextBeforeInput?.dropLast().last, before.isLetter || before.isNumber {
            proxy?.deleteBackward()
            proxy?.insertText(". ")
        } else {
            proxy?.insertText(" ")
        }
        updateAutoShift()
    }

    func deleteBackward() { proxy?.deleteBackward() }
    func newline() { proxy?.insertText("\n") }
    func nextKeyboard() { controller?.advanceToNextInputMode() }

    private var lastShiftTap = Date.distantPast

    /// Tap toggles Shift; a quick second tap locks Caps.
    func toggleShift() {
        let now = Date()
        if capsLock {
            capsLock = false
            shift = false
        } else if shift && now.timeIntervalSince(lastShiftTap) < 0.3 {
            capsLock = true
        } else {
            shift.toggle()
        }
        lastShiftTap = now
    }

    /// Capitalize at the start of a field and after sentence-ending punctuation.
    func updateAutoShift() {
        guard !capsLock else { return }
        let before = proxy?.documentContextBeforeInput ?? ""
        let trimmed = before.trimmingCharacters(in: .whitespaces)
        shift = trimmed.isEmpty || (before.hasSuffix(" ") && [".", "!", "?"].contains(trimmed.last.map(String.init) ?? ""))
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
        let before = proxy?.documentContextBeforeInput ?? ""
        let needsSpace = before.last.map { !$0.isWhitespace } ?? false
        proxy?.insertText(needsSpace ? " " + text : text)
        updateAutoShift()
    }
}
