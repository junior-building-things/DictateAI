import Foundation

/// Speech → rewrite, mirroring the Mac app's default setup: Groq
/// whisper-large-v3-turbo for speech, Gemini 3.5 Flash-Lite for cleanup.
/// Phase 2 replaces this with the shared Rust core so the two can't drift.
enum Pipeline {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Returns the text to insert. Falls back to the raw transcript when the
    /// rewrite fails or returns nothing usable, like the Mac app.
    static func run(wav: Data) async throws -> String {
        let groqKey = SharedSettings.groqKey
        guard !groqKey.isEmpty else { throw Failure(message: "Add a Groq API key in the DictateAI app.") }

        let raw = try await transcribe(wav: wav, apiKey: groqKey, language: SharedSettings.language)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return "" }

        let geminiKey = SharedSettings.geminiKey
        guard !geminiKey.isEmpty else { return raw }
        guard let rewritten = try? await rewrite(raw, apiKey: geminiKey) else { return raw }
        return PostProcess.finalize(rewritten: rewritten, raw: raw)
    }

    // MARK: - Speech (Groq)

    static func transcribe(wav: Data, apiKey: String, language: String) async throws -> String {
        let boundary = "DictateAI-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("model", "whisper-large-v3-turbo")
        field("language", language)
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(wav)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: URL(string: "https://api.groq.com/openai/v1/audio/transcriptions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        struct Response: Decodable { let text: String }
        let data = try await send(request, service: "Groq")
        return try JSONDecoder().decode(Response.self, from: data).text
    }

    // MARK: - Rewrite (Gemini)

    static func rewrite(_ transcript: String, apiKey: String) async throws -> String {
        let payload: [String: Any] = [
            "systemInstruction": ["parts": [["text": Prompt.system]]],
            "contents": [["parts": [["text": Prompt.userMessage(transcript)]]]],
            "generationConfig": [
                "maxOutputTokens": 16384,
                "thinkingConfig": ["thinkingLevel": "minimal"],
            ],
        ]
        var request = URLRequest(url: URL(string:
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        // Header, not `?key=`: URLs end up in error messages.
        request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        struct Response: Decodable {
            struct Candidate: Decodable {
                struct Content: Decodable { struct Part: Decodable { let text: String? }; let parts: [Part] }
                let content: Content
                let finishReason: String?
            }
            let candidates: [Candidate]?
        }
        let data = try await send(request, service: "Gemini")
        guard let candidate = try JSONDecoder().decode(Response.self, from: data).candidates?.first,
              candidate.finishReason != "MAX_TOKENS"  // truncated: use the raw transcript instead
        else { throw Failure(message: "Gemini returned no usable rewrite.") }
        return candidate.content.parts.compactMap(\.text).joined()
    }

    private static func send(_ request: URLRequest, service: String) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let detail = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
            throw Failure(message: "\(service) returned \(status): \(detail)")
        }
        return data
    }
}

/// Ports of the Mac pipeline's post-processing (`src-tauri/src/pipeline.rs`).
enum PostProcess {
    static func finalize(rewritten: String, raw: String) -> String {
        var text = stripPromptFraming(rewritten)
        if stripWrappingQuotes(raw) == raw.trimmingCharacters(in: .whitespacesAndNewlines) {
            text = stripWrappingQuotes(text)
        }
        return isNoChangeSentinel(text) ? raw : text
    }

    static func stripPromptFraming(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("Rewritten:") { t = String(t.dropFirst("Rewritten:".count)).trimmingCharacters(in: .whitespacesAndNewlines) }
        if t.hasPrefix("<transcript>"), t.hasSuffix("</transcript>") {
            t = String(t.dropFirst("<transcript>".count).dropLast("</transcript>".count))
        }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func stripWrappingQuotes(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 2, let first = t.first, let last = t.last else { return t }
        let pairs: [(Character, Character)] = [("\"", "\""), ("'", "'"), ("\u{201C}", "\u{201D}"),
                                               ("\u{2018}", "\u{2019}"), ("\u{300C}", "\u{300D}"),
                                               ("\u{300E}", "\u{300F}"), ("\u{00AB}", "\u{00BB}")]
        guard pairs.contains(where: { $0 == first && $1 == last }) else { return t }
        let inner = t.dropFirst().dropLast()
        // `"Cancel" or "Retry"` starts and ends with quotes but isn't wrapped.
        if inner.contains(first) || inner.contains(last) { return t }
        return inner.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isNoChangeSentinel(_ s: String) -> Bool {
        let normalized = s.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
            .lowercased()
        return ["", "no change", "no changes", "no changes needed", "no change needed", "unchanged",
                "no rewrite", "no rewrite needed", "nothing to change", "nothing to clean",
                "n a", "na", "none"].contains(normalized)
    }
}
