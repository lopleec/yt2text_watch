import Foundation
import Speech

struct Segment: Encodable {
    let start: Double
    let end: Double
    let text: String
    let confidence: Float?
}

struct Output: Encodable {
    let engine: String
    let language: String
    let segments: [Segment]
}

enum HelperError: Error, CustomStringConvertible {
    case badArguments
    case authorizationDenied
    case recognizerUnavailable
    case noResult

    var description: String {
        switch self {
        case .badArguments:
            return "Usage: macos-transcribe <audio.wav> <locale> <online|offline|auto> [output.json]"
        case .authorizationDenied:
            return "Speech recognition authorization was denied"
        case .recognizerUnavailable:
            return "SFSpeechRecognizer is unavailable for the requested locale"
        case .noResult:
            return "Speech recognition produced no result"
        }
    }
}

func requestAuthorization() async -> Bool {
    await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
            continuation.resume(returning: status == .authorized)
        }
    }
}

func recognize(path: String, localeID: String, mode: String) async throws -> Output {
    guard await requestAuthorization() else {
        throw HelperError.authorizationDenied
    }

    let locale = Locale(identifier: localeID)
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
        throw HelperError.recognizerUnavailable
    }

    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    request.shouldReportPartialResults = false
    if mode == "offline" {
        request.requiresOnDeviceRecognition = true
    }

    let result = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<SFSpeechRecognitionResult, Error>) in
        var didFinish = false
        recognizer.recognitionTask(with: request) { result, error in
            if didFinish {
                return
            }

            if let error = error {
                didFinish = true
                continuation.resume(throwing: error)
                return
            }

            if let result = result, result.isFinal {
                didFinish = true
                continuation.resume(returning: result)
            }
        }
    }

    let segments = result.bestTranscription.segments.map { segment in
        Segment(
            start: segment.timestamp,
            end: segment.timestamp + segment.duration,
            text: segment.substring,
            confidence: segment.confidence
        )
    }

    if segments.isEmpty {
        throw HelperError.noResult
    }

    let engine = mode == "offline" ? "macos-speech-on-device" : "macos-speech-system"
    return Output(engine: engine, language: localeID, segments: segments)
}

do {
    guard CommandLine.arguments.count >= 4 else {
        throw HelperError.badArguments
    }

    let output = try await recognize(
        path: CommandLine.arguments[1],
        localeID: CommandLine.arguments[2],
        mode: CommandLine.arguments[3]
    )

    let encoder = JSONEncoder()
    let data = try encoder.encode(output)
    if CommandLine.arguments.count >= 5 {
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[4]))
    } else {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
} catch {
    if CommandLine.arguments.count >= 5 {
        let message = String(describing: error)
        let escaped = message
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        let data = Data("{\"error\":\"\(escaped)\"}\n".utf8)
        try? data.write(to: URL(fileURLWithPath: CommandLine.arguments[4]))
    }
    FileHandle.standardError.write(Data(String(describing: error).utf8))
    FileHandle.standardError.write(Data("\n".utf8))
    exit(1)
}
