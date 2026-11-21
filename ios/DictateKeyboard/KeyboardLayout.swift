import UIKit

enum KeyboardLayer { case letters, numbers, symbols }

enum KeyKind: Equatable {
    /// Inserts this text (letters are stored lowercase).
    case character(String)
    case shift, delete, space, returnKey, globe, emoji
    /// Switches to this layer: 123, ABC, #+=.
    case layer(KeyboardLayer)

    var isCharacter: Bool {
        if case .character = self { return true }
        return false
    }
}

struct KeyFrame: Identifiable, Equatable {
    let id: Int
    let kind: KeyKind
    let rect: CGRect
    /// Letters under a number-pad digit ("ABC").
    var subtitle: String? = nil
}

/// Geometry measured from the iOS 27 system keyboard on a 402 pt wide
/// iPhone (3x screenshots); widths scale with the key width elsewhere.
enum KeyboardMetrics {
    /// 16 pt taller than the system's suggestion bar, which leaves room for a
    /// 34 pt mic button with equal space above (the system's ~17 pt padding)
    /// and below it.
    static let toolbarHeight: CGFloat = 46
    static let rowHeight: CGFloat = 43
    static let rowGap: CGFloat = 11
    static let keyGap: CGFloat = 6.5
    static let sideMargin: CGFloat = 6.75
    static let topInset: CGFloat = 5
    /// iOS ends a third-party keyboard's view 4 pt above where the system
    /// keyboard's bottom row ends and clips anything below, so our rows sit
    /// 4 pt higher than the system's.
    static let bottomInset: CGFloat = 0
    static let cornerRadius: CGFloat = 8.5
    static var keysHeight: CGFloat { topInset + 4 * rowHeight + 3 * rowGap + bottomInset }
    static var totalHeight: CGFloat { toolbarHeight + keysHeight }
}

struct KeyboardLayout {
    let frames: [KeyFrame]

    static func make(width: CGFloat, layer: KeyboardLayer, type: UIKeyboardType, showsGlobe: Bool) -> KeyboardLayout {
        var builder = Builder(width: max(width, 200))
        if type.isNumberPad {
            builder.numberPad(type)
        } else {
            builder.standard(layer: layer, type: type, showsGlobe: showsGlobe)
        }
        return KeyboardLayout(frames: builder.frames)
    }

    /// The key under a touch. Gaps belong to the nearest key, like the
    /// system keyboard, so no tap lands on dead space.
    func key(at point: CGPoint) -> KeyFrame? {
        let dx = KeyboardMetrics.keyGap / 2 + 0.5
        let dy = KeyboardMetrics.rowGap / 2 + 0.5
        if let hit = frames.first(where: { $0.rect.insetBy(dx: -dx, dy: -dy).contains(point) }) {
            return hit
        }
        return frames.min { distance($0.rect, point) < distance($1.rect, point) }
    }

    private func distance(_ rect: CGRect, _ p: CGPoint) -> CGFloat {
        let x = max(rect.minX - p.x, 0, p.x - rect.maxX)
        let y = max(rect.minY - p.y, 0, p.y - rect.maxY)
        return x * x + y * y
    }
}

private struct Builder {
    typealias M = KeyboardMetrics
    let width: CGFloat
    var frames: [KeyFrame] = []

    var keyWidth: CGFloat { (width - 2 * M.sideMargin - 9 * M.keyGap) / 10 }
    var scale: CGFloat { keyWidth / 33 }
    var sideKeyWidth: CGFloat { 45.5 * scale }   // shift, delete, #+=
    var bottomKeyWidth: CGFloat { 43.3 * scale } // 123, emoji, globe
    var returnWidth: CGFloat { 92.7 * scale }
    /// Gap between shift / delete and the letters in the third row.
    var sideGap: CGFloat { 13.6 * scale }

    func rowY(_ row: Int) -> CGFloat { M.topInset + CGFloat(row) * (M.rowHeight + M.rowGap) }

    mutating func add(_ kind: KeyKind, x: CGFloat, width w: CGFloat, row: Int, subtitle: String? = nil) {
        frames.append(KeyFrame(id: frames.count, kind: kind,
                               rect: CGRect(x: x, y: rowY(row), width: w, height: M.rowHeight),
                               subtitle: subtitle))
    }

    /// Character keys of the standard width, centered in the row.
    mutating func centeredRow(_ keys: String, row: Int) {
        let chars = keys.map(String.init)
        let total = CGFloat(chars.count) * keyWidth + CGFloat(chars.count - 1) * M.keyGap
        var x = (width - total) / 2
        for c in chars {
            add(.character(c), x: x, width: keyWidth, row: row)
            x += keyWidth + M.keyGap
        }
    }

    /// Third row: a side key, characters stretched to fill, delete.
    mutating func thirdRow(left: KeyKind, characters: String, stretch: Bool) {
        add(left, x: M.sideMargin, width: sideKeyWidth, row: 2)
        let deleteX = width - M.sideMargin - sideKeyWidth
        let chars = characters.map(String.init)
        if stretch {
            let start = M.sideMargin + sideKeyWidth + sideGap
            let available = deleteX - sideGap - start
            let w = (available - CGFloat(chars.count - 1) * M.keyGap) / CGFloat(chars.count)
            for (i, c) in chars.enumerated() {
                add(.character(c), x: start + CGFloat(i) * (w + M.keyGap), width: w, row: 2)
            }
        } else {
            centeredRow(characters, row: 2)
        }
        add(.delete, x: deleteX, width: sideKeyWidth, row: 2)
    }

    mutating func standard(layer: KeyboardLayer, type: UIKeyboardType, showsGlobe: Bool) {
        switch layer {
        case .letters:
            centeredRow("qwertyuiop", row: 0)
            centeredRow("asdfghjkl", row: 1)
            thirdRow(left: .shift, characters: "zxcvbnm", stretch: false)
        case .numbers:
            centeredRow("1234567890", row: 0)
            centeredRow("-/:;()$&@\"", row: 1)
            thirdRow(left: .layer(.symbols), characters: ".,?!'", stretch: true)
        case .symbols:
            centeredRow("[]{}#%^*+=", row: 0)
            centeredRow("_\\|~<>€£¥•", row: 1)
            thirdRow(left: .layer(.numbers), characters: ".,?!'", stretch: true)
        }

        // Bottom row: layer switch, (globe), emoji, field-specific keys, space, return.
        var x = M.sideMargin
        func place(_ kind: KeyKind, _ w: CGFloat, into b: inout Builder) {
            b.add(kind, x: x, width: w, row: 3)
            x += w + M.keyGap
        }
        place(.layer(layer == .letters ? .numbers : .letters), bottomKeyWidth, into: &self)
        if showsGlobe { place(.globe, bottomKeyWidth, into: &self) }
        place(.emoji, bottomKeyWidth, into: &self)

        let extras: [String]
        var hasSpace = true
        switch type {
        case .emailAddress: extras = ["@", "."]
        case .URL: extras = [".", "/", ".com"]; hasSpace = false
        case .twitter: extras = ["@", "#"]
        case .webSearch: extras = ["."]
        default: extras = []
        }
        let returnX = width - M.sideMargin - returnWidth
        let extraWidth = hasSpace ? bottomKeyWidth : (returnX - M.keyGap - x - CGFloat(extras.count - 1) * M.keyGap) / CGFloat(extras.count)
        if hasSpace {
            let spaceWidth = returnX - M.keyGap - x - CGFloat(extras.count) * (extraWidth + M.keyGap)
            place(.space, spaceWidth, into: &self)
        }
        for e in extras { place(.character(e), extraWidth, into: &self) }
        add(.returnKey, x: returnX, width: returnWidth, row: 3)
    }

    mutating func numberPad(_ type: UIKeyboardType) {
        let w = (width - 2 * M.sideMargin - 2 * M.keyGap) / 3
        let letters = ["", "ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ"]
        for i in 0..<9 {
            add(.character("\(i + 1)"), x: M.sideMargin + CGFloat(i % 3) * (w + M.keyGap),
                width: w, row: i / 3, subtitle: letters[i].isEmpty ? nil : letters[i])
        }
        switch type {
        case .decimalPad:
            add(.character(Locale.current.decimalSeparator ?? "."), x: M.sideMargin, width: w, row: 3)
        case .phonePad:
            add(.character("+"), x: M.sideMargin, width: w, row: 3)
        default:
            break
        }
        add(.character("0"), x: M.sideMargin + w + M.keyGap, width: w, row: 3)
        add(.delete, x: M.sideMargin + 2 * (w + M.keyGap), width: w, row: 3)
    }
}

extension UIKeyboardType {
    var isNumberPad: Bool {
        [.numberPad, .phonePad, .decimalPad, .asciiCapableNumberPad].contains(self)
    }
}

/// Press-and-hold alternates, following the US English system keyboard.
enum Alternates {
    static func options(for character: String) -> [String] {
        table[character.lowercased()] ?? []
    }

    private static let table: [String: [String]] = [
        "a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"],
        "c": ["ç", "ć", "č"],
        "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"],
        "i": ["î", "ï", "í", "ī", "į", "ì"],
        "l": ["ł"],
        "n": ["ñ", "ń"],
        "o": ["ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"],
        "s": ["ß", "ś", "š"],
        "u": ["û", "ü", "ù", "ú", "ū"],
        "y": ["ÿ"],
        "z": ["ž", "ź", "ż"],
        "-": ["–", "—", "•"],
        "/": ["\\"],
        "$": ["₽", "¥", "€", "¢", "£", "₩"],
        "&": ["§"],
        "\"": ["”", "„", "“", "»", "«"],
        ".": ["…"],
        "?": ["¿"],
        "!": ["¡"],
        "'": ["’", "‘", "`"],
        "0": ["°"],
        "%": ["‰"],
    ]
}
