import AVFoundation

/// Records the microphone inside the keyboard extension, as 16 kHz mono
/// 16-bit PCM — the same audio the Mac app uploads.
final class Recorder {
    /// Keyboards get a small memory budget; 5 minutes of 16 kHz Int16 is ~9.6 MB.
    static let maxSeconds: Double = 300
    private static let sampleRate: Double = 16_000

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var samples: [Int16] = []
    private let lock = NSLock()

    var onLimitReached: (() -> Void)?

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else {
            throw Pipeline.Failure(message: "The microphone isn't available to the keyboard. Check Full Access and microphone permission.")
        }
        let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Self.sampleRate, channels: 1, interleaved: true)!
        converter = AVAudioConverter(from: inputFormat, to: target)
        lock.withLock { samples.removeAll(keepingCapacity: true) }

        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            self?.append(buffer, target: target)
        }
        engine.prepare()
        try engine.start()
    }

    /// Stops recording and returns the audio as a WAV file.
    func stop() -> Data {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let recorded = lock.withLock { samples }
        return Self.wav(recorded)
    }

    private func append(_ buffer: AVAudioPCMBuffer, target: AVAudioFormat) {
        guard let converter else { return }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate) + 1
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var supplied = false
        converter.convert(to: out, error: nil) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        guard let channel = out.int16ChannelData?[0] else { return }
        let reachedLimit: Bool = lock.withLock {
            samples.append(contentsOf: UnsafeBufferPointer(start: channel, count: Int(out.frameLength)))
            return Double(samples.count) >= Self.maxSeconds * Self.sampleRate
        }
        if reachedLimit { DispatchQueue.main.async { self.onLimitReached?() } }
    }

    private static func wav(_ samples: [Int16]) -> Data {
        let dataSize = UInt32(samples.count * 2)
        var data = Data()
        func put<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        data.append("RIFF".data(using: .ascii)!); put(UInt32(36) + dataSize)
        data.append("WAVEfmt ".data(using: .ascii)!)
        put(UInt32(16)); put(UInt16(1)); put(UInt16(1))            // PCM, mono
        put(UInt32(sampleRate)); put(UInt32(sampleRate * 2))       // byte rate
        put(UInt16(2)); put(UInt16(16))                            // block align, bits
        data.append("data".data(using: .ascii)!); put(dataSize)
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        return data
    }
}
