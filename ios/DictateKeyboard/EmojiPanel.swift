import SwiftUI

/// Emoji grouped roughly like the system emoji keyboard, built from Unicode
/// blocks at runtime (no bundled data), plus recently used.
enum EmojiData {
    struct Category: Identifiable {
        let id: String
        let icon: String
        let emoji: [String]
    }

    private static let recentsKey = "recentEmoji"

    static var recents: [String] {
        SharedSettings.defaults.stringArray(forKey: recentsKey) ?? []
    }

    static func recordRecent(_ emoji: String) {
        var list = recents.filter { $0 != emoji }
        list.insert(emoji, at: 0)
        SharedSettings.defaults.set(Array(list.prefix(30)), forKey: recentsKey)
    }

    static let categories: [Category] = [
        Category(id: "Smileys & People", icon: "face.smiling", emoji: scalars([
            0x1F600...0x1F64F, 0x1F910...0x1F92F, 0x1F970...0x1F97A, 0x1F9D0...0x1F9DF,
            0x1FAE0...0x1FAE8, 0x1F440...0x1F450, 0x1F466...0x1F487, 0x1F4AA...0x1F4AA,
            0x1F590...0x1F596, 0x1F918...0x1F91F, 0x1F930...0x1F939, 0x1FAF0...0x1FAF8,
        ])),
        Category(id: "Animals & Nature", icon: "pawprint", emoji: scalars([
            0x1F400...0x1F43F, 0x1F980...0x1F9AE, 0x1FAB0...0x1FABD, 0x1F331...0x1F343,
            0x1F300...0x1F31F, 0x1F490...0x1F490, 0x1F4AE...0x1F4AE, 0x1FAB7...0x1FABF,
        ])),
        Category(id: "Food & Drink", icon: "fork.knife", emoji: scalars([
            0x1F344...0x1F37F, 0x1F950...0x1F96F, 0x1F9C0...0x1F9CB, 0x1FAD0...0x1FADB,
        ])),
        Category(id: "Activity", icon: "soccerball", emoji: scalars([
            0x1F380...0x1F3CA, 0x1F3CF...0x1F3D3, 0x1F3F8...0x1F3F9, 0x1F93A...0x1F94F, 0x1FA80...0x1FA8F,
        ])),
        Category(id: "Travel & Places", icon: "car", emoji: scalars([
            0x1F680...0x1F6FF, 0x1F3D4...0x1F3F0, 0x1F5FA...0x1F5FF,
        ])),
        Category(id: "Objects", icon: "lightbulb", emoji: scalars([
            0x1F4A1...0x1F4FF, 0x1F500...0x1F53D, 0x1F56F...0x1F5F9, 0x1FA70...0x1FA7F, 0x1FA90...0x1FAAF,
        ])),
        Category(id: "Symbols", icon: "heart", emoji: scalars([
            0x2600...0x27BF, 0x1F49B...0x1F49F, 0x1F7E0...0x1F7EB, 0x1F170...0x1F251, 0x1F550...0x1F567,
        ])),
        Category(id: "Flags", icon: "flag", emoji: flags),
    ]

    // MARK: Suggestions

    /// Three emoji for the word being typed (or just typed): a short list of
    /// common chat words first, then Unicode emoji names ("pizza" → 🍕),
    /// topped up with recents and favorites so the bar is never empty.
    static func suggestions(for word: String) -> [String] {
        var seen = Set<String>()
        return Array((matches(for: word) + recents + ["😂", "❤️", "👍"]).filter { seen.insert($0).inserted }.prefix(3))
    }

    /// Emoji that fit the word, best first; empty when nothing does.
    static func matches(for word: String) -> [String] {
        let query = word.lowercased()
        guard query.count >= 2 else { return [] }
        let exact = nameIndex.filter { $0.words.contains(query) }
        // From 4 letters, so everyday words like "the" don't pull in 🤒 (thermometer).
        let prefix = query.count >= 4 ? nameIndex.filter { $0.words.contains { $0.hasPrefix(query) } } : []
        return (chatWords[query] ?? []) + (exact + prefix).sorted { $0.nameLength < $1.nameLength }.map(\.emoji)
    }

    private struct NamedEmoji {
        let emoji: String
        let words: [String]
        let nameLength: Int
    }

    private static let stopWords: Set<String> = ["with", "of", "and", "the", "in", "on", "for", "to", "sign", "symbol"]

    private static let nameIndex: [NamedEmoji] = categories.filter { $0.id != "Flags" }.flatMap(\.emoji).compactMap { emoji in
        guard let name = emoji.unicodeScalars.first?.properties.name?.lowercased() else { return nil }
        let words = name.split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init).filter { !stopWords.contains($0) }
        return NamedEmoji(emoji: emoji, words: words, nameLength: name.count)
    }

    private static let chatWords: [String: [String]] = {
        let groups: [([String], [String])] = [
            (["love", "luv", "heart"], ["❤️", "😍", "🥰"]),
            (["happy", "glad", "smile"], ["😊", "😄", "🥳"]),
            (["lol", "haha", "hahaha", "lmao", "funny", "hilarious"], ["😂", "🤣", "😆"]),
            (["sad", "unhappy"], ["😢", "😞", "😔"]),
            (["cry", "crying"], ["😭", "😢", "🥲"]),
            (["ok", "okay", "fine"], ["👌", "👍", "🙆"]),
            (["yes", "yeah", "yep", "sure"], ["👍", "✅", "🙌"]),
            (["no", "nope", "nah"], ["🙅", "👎", "❌"]),
            (["thanks", "thank", "thx", "ty", "please"], ["🙏", "😊", "🤗"]),
            (["wow", "omg", "whoa"], ["😮", "🤯", "😱"]),
            (["cool", "nice", "great", "good", "awesome"], ["👍", "😎", "🙌"]),
            (["party", "congrats", "congratulations", "birthday", "celebrate"], ["🥳", "🎉", "🎂"]),
            (["hi", "hello", "hey", "bye", "goodbye"], ["👋", "😊", "🙂"]),
            (["sleep", "tired", "night", "sleepy"], ["😴", "🥱", "🌙"]),
            (["angry", "mad", "annoyed"], ["😠", "😡", "🤬"]),
            (["kiss", "kisses", "xoxo"], ["😘", "💋", "😗"]),
            (["think", "hmm", "maybe", "wonder"], ["🤔", "🧐", "💭"]),
            (["fire", "lit", "hot"], ["🔥", "💯", "🚀"]),
            (["sorry", "oops"], ["😔", "🙏", "🥺"]),
            (["coffee", "tea"], ["☕", "🍵", "🥐"]),
            (["hungry", "food", "eat", "dinner", "lunch"], ["🍕", "🍔", "🍜"]),
            (["beer", "drinks", "drink", "cheers", "wine"], ["🍻", "🍷", "🥂"]),
            (["money", "rich", "paid", "pay"], ["💰", "💵", "🤑"]),
            (["cute", "aww", "adorable"], ["🥺", "🥰", "😊"]),
            (["scared", "afraid", "scary"], ["😱", "😨", "👻"]),
            (["sick", "ill"], ["🤒", "🤢", "😷"]),
            (["dead", "dying", "rip"], ["💀", "😵", "🪦"]),
            (["home", "house"], ["🏠", "🏡", "🛋️"]),
            (["work", "working", "office"], ["💼", "💻", "🏢"]),
            (["run", "running", "gym", "workout"], ["🏃", "💪", "🏋️"]),
        ]
        var map: [String: [String]] = [:]
        for (words, emoji) in groups { for w in words { map[w] = emoji } }
        return map
    }()

    private static func scalars(_ ranges: [ClosedRange<UInt32>]) -> [String] {
        var seen = Set<String>()
        return ranges.flatMap { $0 }.compactMap { value -> String? in
            guard let scalar = Unicode.Scalar(value), scalar.properties.isEmojiPresentation else { return nil }
            let s = String(scalar)
            return seen.insert(s).inserted ? s : nil
        }
    }

    private static var flags: [String] {
        Locale.Region.isoRegions
            .map(\.identifier)
            .filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }
            .sorted()
            .map { code in
                String(String.UnicodeScalarView(code.uppercased().unicodeScalars.compactMap {
                    Unicode.Scalar(0x1F1E6 - 0x41 + $0.value)
                }))
            }
    }
}

struct EmojiPanel: View {
    @ObservedObject var model: KeyboardModel
    let palette: KeyPalette
    @State private var current = "Recent"

    private var sections: [EmojiData.Category] {
        let recents = EmojiData.recents
        let recent = recents.isEmpty ? [] : [EmojiData.Category(id: "Recent", icon: "clock", emoji: recents)]
        return recent + EmojiData.categories
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { reader in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHGrid(rows: Array(repeating: GridItem(.fixed(38), spacing: 2), count: 4), spacing: 4,
                              pinnedViews: []) {
                        ForEach(sections) { section in
                            Section {
                                ForEach(section.emoji, id: \.self) { emoji in
                                    Button { model.insertEmoji(emoji) } label: {
                                        Text(emoji).font(.system(size: 30)).frame(width: 40, height: 38)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .id(section.id)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .onChange(of: current) { _, id in reader.scrollTo(id, anchor: .leading) }
                .clipped()
            }
            HStack(spacing: 0) {
                Button("ABC") { model.closeEmoji() }
                    .font(.system(size: 16)).foregroundStyle(palette.text).frame(width: 48)
                ForEach(sections) { section in
                    Button { current = section.id } label: {
                        Image(systemName: section.icon).font(.system(size: 15))
                            .foregroundStyle(current == section.id ? palette.text : palette.secondaryText)
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.plain)
                }
                Button { model.deleteBackward() } label: {
                    Image(systemName: "delete.left").font(.system(size: 17)).foregroundStyle(palette.text)
                        .frame(width: 44, height: 32)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 4)
        }
        .padding(.top, 4)
    }
}
