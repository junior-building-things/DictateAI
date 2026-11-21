import SwiftUI
import UIKit

/// Handles every touch on the key area in UIKit: multitouch rollover for fast
/// two-thumb typing, gapless hit areas, sliding between keys, press-and-hold
/// accents, held delete, the space-bar trackpad and the globe key.
final class KeyboardTouchView: UIView {
    private final class Tracker {
        enum Mode { case normal, accent, trackpad }
        var key: KeyFrame
        var mode: Mode = .normal
        var timer: Timer?
        var lastX: CGFloat = 0
        var deletes = 0
        init(key: KeyFrame) { self.key = key }
    }

    var model: KeyboardModel?
    private var trackers: [ObjectIdentifier: Tracker] = [:]

    /// Points of horizontal travel per cursor step on the space-bar trackpad.
    private let trackpadStep: CGFloat = 8

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError() }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        MainActor.assumeIsolated {
            guard let model else { return }
            for touch in touches {
                guard let key = model.layout.key(at: touch.location(in: self)) else { continue }
                // Rollover: a new key commits any character still held down.
                for (id, other) in trackers where other.mode == .normal && other.key.kind.isCharacter {
                    other.timer?.invalidate()
                    model.keyUp(other.key)
                    trackers[id] = nil
                }
                let tracker = Tracker(key: key)
                trackers[ObjectIdentifier(touch)] = tracker
                model.keyDown(key)
                begin(tracker, touch: touch, event: event)
            }
        }
    }

    private func begin(_ tracker: Tracker, touch: UITouch, event: UIEvent?) {
        guard let model else { return }
        switch tracker.key.kind {
        case .character:
            schedule(tracker, after: 0.4) { [weak self] in
                if self?.model?.showAccents(for: tracker.key) == true { tracker.mode = .accent }
            }
        case .delete:
            schedule(tracker, after: 0.5, repeating: 0.09) { [weak self] in
                tracker.deletes += 1
                if tracker.deletes > 12 { self?.model?.deleteWord() } else { self?.model?.deleteBackward() }
            }
        case .space:
            let x = touch.location(in: self).x
            schedule(tracker, after: 0.45) { [weak self] in
                tracker.mode = .trackpad
                tracker.lastX = x
                self?.model?.setTrackpad(true)
            }
        case .globe:
            model.advanceKeyboard(from: self, with: event)
        default:
            break
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        MainActor.assumeIsolated {
            guard let model else { return }
            for touch in touches {
                guard let tracker = trackers[ObjectIdentifier(touch)] else { continue }
                let p = touch.location(in: self)
                switch tracker.mode {
                case .accent:
                    model.selectAccent(atX: p.x)
                case .trackpad:
                    let steps = Int((p.x - tracker.lastX) / trackpadStep)
                    if steps != 0 {
                        model.moveCursor(by: steps)
                        tracker.lastX += CGFloat(steps) * trackpadStep
                    }
                case .normal:
                    if case .globe = tracker.key.kind {
                        model.advanceKeyboard(from: self, with: event)
                    } else if tracker.key.kind.isCharacter, let next = model.layout.key(at: p),
                              next.id != tracker.key.id, next.kind.isCharacter {
                        tracker.timer?.invalidate()
                        model.keyMoved(from: tracker.key, to: next)
                        tracker.key = next
                        begin(tracker, touch: touch, event: event)
                    }
                }
            }
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        MainActor.assumeIsolated {
            guard let model else { return }
            for touch in touches {
                guard let tracker = trackers.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
                tracker.timer?.invalidate()
                switch tracker.mode {
                case .accent:
                    model.commitAccent()
                case .trackpad:
                    model.release(tracker.key)
                    model.setTrackpad(false)
                case .normal:
                    if case .globe = tracker.key.kind {
                        model.release(tracker.key)
                        model.advanceKeyboard(from: self, with: event)
                    } else {
                        model.keyUp(tracker.key)
                    }
                }
            }
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        MainActor.assumeIsolated {
            for touch in touches {
                trackers.removeValue(forKey: ObjectIdentifier(touch))?.timer?.invalidate()
            }
            if trackers.isEmpty { model?.cancelAll() }
        }
    }

    private func schedule(_ tracker: Tracker, after delay: TimeInterval, repeating interval: TimeInterval? = nil,
                          _ action: @escaping @MainActor () -> Void) {
        tracker.timer?.invalidate()
        let timer = Timer(timeInterval: interval ?? delay, repeats: interval != nil) { _ in
            MainActor.assumeIsolated { action() }
        }
        timer.fireDate = Date().addingTimeInterval(delay)
        RunLoop.main.add(timer, forMode: .common)
        tracker.timer = timer
    }
}

struct KeyboardTouchLayer: UIViewRepresentable {
    let model: KeyboardModel

    func makeUIView(context: Context) -> KeyboardTouchView {
        let view = KeyboardTouchView()
        view.model = model
        return view
    }

    func updateUIView(_ view: KeyboardTouchView, context: Context) {
        view.model = model
    }
}
