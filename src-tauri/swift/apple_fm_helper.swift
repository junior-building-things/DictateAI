// Helper invoked by the Rust pipeline to talk to Apple's on-device
// Foundation Models framework (macOS 26+). Two modes:
//
//   apple-fm-helper --check
//     Prints "available" on stdout when the system model is ready;
//     exits 3 with a message on stderr otherwise.
//
//   apple-fm-helper
//     Reads `{"system": "...", "user": "..."}` JSON from stdin, writes
//     the model's response text to stdout, exits 0. Errors go to stderr
//     with a non-zero exit code.
//
// The Foundation Models framework is Swift-only, so this tiny CLI is the
// bridge between our Rust pipeline and the OS-managed model.

import Foundation
import FoundationModels

struct Input: Decodable {
    let system: String
    let user: String
}

func emitError(_ message: String, exitCode: Int32) -> Never {
    let line = "apple-fm-helper: \(message)\n"
    FileHandle.standardError.write(line.data(using: .utf8) ?? Data())
    exit(exitCode)
}

func checkAvailability() -> Never {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
        let line = "available\n"
        FileHandle.standardOutput.write(line.data(using: .utf8) ?? Data())
        exit(0)
    default:
        emitError("model unavailable", exitCode: 3)
    }
}

@main
struct Helper {
    static func main() async {
        if CommandLine.arguments.contains("--check") {
            checkAvailability()
        }

        let stdin = FileHandle.standardInput.readDataToEndOfFile()
        guard let input = try? JSONDecoder().decode(Input.self, from: stdin) else {
            emitError("invalid input JSON", exitCode: 2)
        }

        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            break
        default:
            emitError("model unavailable", exitCode: 3)
        }

        // FoundationModels has no formal "system" role — we just concat the
        // instructions into the user prompt with a blank-line separator,
        // which matches Apple's sample-code pattern.
        let prompt: String
        if input.system.isEmpty {
            prompt = input.user
        } else {
            prompt = "\(input.system)\n\n\(input.user)"
        }

        do {
            let session = LanguageModelSession()
            let response = try await session.respond(to: prompt)
            FileHandle.standardOutput.write(response.content.data(using: .utf8) ?? Data())
        } catch {
            emitError("inference failed: \(error)", exitCode: 1)
        }
    }
}
