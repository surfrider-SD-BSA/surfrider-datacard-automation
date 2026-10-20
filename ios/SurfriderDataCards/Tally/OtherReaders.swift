import Foundation
import CoreGraphics
import ImageIO
import OnnxRuntimeBindings

/// Eight open handwriting readers, run on the phone with ONNX Runtime over the
/// boxes our reader read as digits: docTR's CRNN, PARSeq (fine-tuned on the
/// chapter's boxes, scripts/train-parseq.py) and ViTSTR,
/// PaddleOCR's PP-OCRv5 server recognizer, EasyOCR's recognizer, and TrOCR
/// small, base and large.
///
/// PP-OCRv5 and the tuned PARSeq read better than ours where they answer, yet
/// even PP-OCRv5's number is worse to take than ours on the boxes taken unseen
/// (8,512 against 7,606). They make other mistakes than ours, though: where
/// several read another number at once,
/// ours is usually the one wrong, so the box is shown first
/// (`OTHER_READERS_DISAGREE` in src/lib/prefill.ts, which also turns their
/// text into numbers). Each reader is loaded, run over every box and let go
/// before the next, so only one is in memory at a time.
///
/// Every step here copies the recipe measured in out/exp/wa/phone.py and
/// phone_trocr.py: the same crop, resize, normalisation and decoding, so the
/// phone reads what was scored. The models are built by
/// scripts/export-readers.py into the `readers` folder; without it, no reader
/// runs and nothing changes.
enum OtherReaders {
    /// Cheapest first: a box stops being read once its outcome is settled, so
    /// the slow TrOCRs read only the few boxes still in doubt.
    static let names = [
        "paddle-v5", "easyocr-rec", "doctr-crnn", "doctr-vitstr", "doctr-parseq",
        "trocr-small", "trocr-base", "trocr-large",
    ]

    /// `OTHER_READERS_DISAGREE` in src/lib/prefill.ts.
    static let disagree = 4

    /// The first this many readers -- the fast ones -- read every box; the
    /// TrOCRs only boxes still undecided. About 45 s of a scan.
    static let everyBox = 5

    /// The most the open readers may take on one scan, after our tuned reader's
    /// `mainBudget`. A scan has to read in under 3 min 30 s on the
    /// phone (the owner's line, 18 October 2026), and reading, tiling and
    /// Apple's reader take the rest. What is not read by
    /// then keeps fewer votes, so at worst a box is ranked as it was before.
    static let budget: TimeInterval = 110

    /// The most our tuned reader may take on one scan (~0.1 s a box on an
    /// M-series Mac; a scan has 244 written boxes on average). It reads first
    /// and gets the larger share: in the simulator with the Mac busy, 45 s read
    /// 203 of 299 boxes. Its number is worth more than the vote's last voices.
    static let mainBudget: TimeInterval = 60

    /// All the phone's cores, up to the six an iPhone has: a 299-box scan took
    /// 4 min 36 s on two threads in the simulator.
    static let threads = Int32(min(6, max(2, ProcessInfo.processInfo.activeProcessorCount)))

    /// Each box's text from each reader, in `names` order; nil where a reader
    /// is missing, read nothing, or was not needed.
    ///
    /// The fast readers (`everyBox`) read every box. A TrOCR reads a box only
    /// while it is undecided: fewer than `disagree` readers have read another
    /// number than `values` (ours), enough readers are left to get there, and
    /// Apple has not already disagreed (`flagged`). Which boxes are flagged
    /// comes out exactly as if all eight had read every box; TrOCR-large reads
    /// about 6% of them. src/lib/prefill.ts was measured with these counts.
    static func read(_ pngs: [Data], values: [Int], flagged: [Bool]) -> [[String?]] {
        let images = pngs.map(Pixels.init(png:))
        var texts = Array(repeating: [String?](repeating: nil, count: names.count), count: pngs.count)
        guard let folder = Bundle.main.url(forResource: "readers", withExtension: nil),
              let env = try? ORTEnv(loggingLevel: .warning) else { return texts }
        var disagreed = [Int](repeating: 0, count: pngs.count)
        let deadline = Date().addingTimeInterval(budget)
        for (r, name) in names.enumerated() {
            if Date() >= deadline { break }
            let left = names.count - r
            // The fast readers read every box: how many disagree ranks a box
            // (OTHER_READERS_WEIGHT), not only whether four do.
            let open = images.indices.filter { b in
                images[b] != nil && (r < everyBox ||
                    (!flagged[b] && disagreed[b] < disagree && disagreed[b] + left >= disagree))
            }
            if open.isEmpty { continue }
            autoreleasepool {
                guard let reader = load(name, in: folder, env: env) else { return }
                for b in open {
                    if Date() >= deadline { break }
                    texts[b][r] = try? reader(images[b]!)
                    if let n = number(texts[b][r]), n != values[b] { disagreed[b] += 1 }
                }
            }
        }
        return texts
    }

    /// Our tuned reader's text (TrOCR-small fine-tuned on the chapter's boxes,
    /// scripts/train-trocr.py, in `readers/trocr-ours`) for every box, nil
    /// where it read nothing, ran out of `mainBudget` or is not there. Its
    /// number is the one filled in (`mainReading` in src/lib/prefill.ts).
    static func readMain(_ pngs: [Data]) -> [String?] {
        var texts = [String?](repeating: nil, count: pngs.count)
        guard let folder = Bundle.main.url(forResource: "readers", withExtension: nil),
              let env = try? ORTEnv(loggingLevel: .warning) else { return texts }
        autoreleasepool {
            guard let reader = load("trocr-ours", in: folder, env: env) else { return }
            let deadline = Date().addingTimeInterval(mainBudget)
            for b in pngs.indices {
                if Date() >= deadline { break }
                guard let image = Pixels(png: pngs[b]) else { continue }
                texts[b] = try? reader(image)
            }
        }
        return texts
    }

    /// `numberFromReader` in src/lib/prefill.ts: lookalike letters read as
    /// digits, then the first run of ASCII digits, at most 999.
    static func number(_ text: String?) -> Int? {
        guard let text else { return nil }
        let lookalike: [Character: Character] = [
            "l": "1", "I": "1", "|": "1", "i": "1", "!": "1", "O": "0", "o": "0", "D": "0", "Q": "0",
            "S": "5", "s": "5", "Z": "2", "z": "2", "B": "8", "g": "9", "q": "9", "G": "6", "b": "6",
            "T": "7", "A": "4",
        ]
        let digits = text.map { lookalike[$0] ?? $0 }.drop { !("0"..."9").contains($0) }.prefix { ("0"..."9").contains($0) }
        guard !digits.isEmpty else { return nil }
        return min(Int(digits.prefix(6).map(String.init).joined()) ?? 999, 999)
    }

    private typealias Reader = (Pixels) throws -> String

    private static func session(_ url: URL, _ env: ORTEnv) throws -> ORTSession {
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(threads)
        return try ORTSession(env: env, modelPath: url.path, sessionOptions: options)
    }

    private static func json(_ url: URL) -> Any? {
        (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0, options: [.fragmentsAllowed]) }
    }

    private static func load(_ name: String, in folder: URL, env: ORTEnv) -> Reader? {
        do {
            switch name {
            case "doctr-crnn", "doctr-parseq", "doctr-vitstr":
                guard let vocab = (json(folder.appendingPathComponent("\(name).vocab.json")) as? String).map(Array.init)
                else { return nil }
                let s = try session(folder.appendingPathComponent("\(name).onnx"), env)
                let ctc = name == "doctr-crnn"
                return { image in
                    let (logits, steps, classes) = try run(s, ["input": tensor(image.doctr(), [1, 3, 32, 128])], "logits")
                    var text = "", previous = -1
                    for t in 0..<steps {
                        let k = try argmax(logits, t * classes, classes)
                        if ctc {
                            if k != previous && k != vocab.count { text.append(vocab[k]) }
                            previous = k
                        } else {
                            if k >= vocab.count { break }
                            text.append(vocab[k])
                        }
                    }
                    return text
                }
            case "paddle-v5", "easyocr-rec":
                guard let vocab = json(folder.appendingPathComponent("\(name).vocab.json")) as? [String] else { return nil }
                let s = try session(folder.appendingPathComponent("\(name).onnx"), env)
                let paddle = name == "paddle-v5"
                // EasyOCR is asked for digits only, as it was measured.
                let keep = vocab.enumerated().map { $0.offset == 0 || $0.element.allSatisfy(\.isNumber) }
                return { image in
                    let (input, shape) = paddle ? image.paddle() : image.easyocr()
                    let (logits, steps, classes) = try run(s, [paddle ? "x" : "input": tensor(input, shape)], nil)
                    var text = "", previous = -1
                    for t in 0..<steps {
                        let k = try argmax(logits, t * classes, classes, keep: paddle ? nil : keep)
                        if k != previous && k != 0 { text += vocab[k] }
                        previous = k
                    }
                    return text
                }
            default: // trocr-*
                let dir = folder.appendingPathComponent(name)
                guard let v = json(dir.appendingPathComponent("vocab.json")) as? [String: Any],
                      let tokens = v["tokens"] as? [String], let start = v["start"] as? Int, let eos = v["eos"] as? Int
                else { return nil }
                let encoder = try session(dir.appendingPathComponent("encoder.onnx"), env)
                let decoder = try session(dir.appendingPathComponent("decoder.onnx"), env)
                return { image in
                    let hidden = try encoder.run(
                        withInputs: ["pixel_values": tensor(image.trocr(), [1, 3, 384, 384])],
                        outputNames: ["hidden"], runOptions: nil)["hidden"]!
                    var ids = [Int64(start)], text = ""
                    for _ in 0..<8 {
                        let idsTensor = try ORTValue(
                            tensorData: NSMutableData(bytes: ids, length: ids.count * 8), elementType: .int64,
                            shape: [1, NSNumber(value: ids.count)])
                        let out = try decoder.run(withInputs: ["input_ids": idsTensor, "hidden": hidden],
                                                  outputNames: ["logits"], runOptions: nil)["logits"]!
                        let logits = try floats(out), classes = try out.tensorTypeAndShapeInfo().shape.last!.intValue
                        let k = try argmax(logits, (ids.count - 1) * classes, classes)
                        if k == eos { break }
                        ids.append(Int64(k))
                        text += tokens[k]
                    }
                    return text.replacingOccurrences(of: "Ġ", with: " ").replacingOccurrences(of: "▁", with: " ")
                        .trimmingCharacters(in: .whitespaces)
                }
            }
        } catch {
            return nil
        }
    }

    private static func tensor(_ values: [Float], _ shape: [Int]) throws -> ORTValue {
        let data = values.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * 4) }
        return try ORTValue(tensorData: data, elementType: .float, shape: shape.map { NSNumber(value: $0) })
    }

    private static func floats(_ value: ORTValue) throws -> [Float] {
        let data = try value.tensorData() as Data
        return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    /// The first output (or `name`) as floats, with its last two dimensions: steps and classes.
    private static func run(_ s: ORTSession, _ inputs: [String: ORTValue], _ name: String?) throws -> ([Float], Int, Int) {
        let outputName = try name ?? s.outputNames().first!
        let out = try s.run(withInputs: inputs, outputNames: [outputName], runOptions: nil)[outputName]!
        let shape = try out.tensorTypeAndShapeInfo().shape.map(\.intValue)
        return (try floats(out), shape[shape.count - 2], shape[shape.count - 1])
    }

    /// The likeliest class at one step. Throws on output that is not a number
    /// (a model stored too small gives NaN), so that reader gives nothing for
    /// the box rather than taking the app down.
    private static func argmax(_ v: [Float], _ at: Int, _ n: Int, keep: [Bool]? = nil) throws -> Int {
        var best = -1, top = -Float.infinity
        for k in 0..<n where keep?[k] ?? true {
            if v[at + k] > top { top = v[at + k]; best = k }
        }
        guard best >= 0 else { throw ReaderError.notANumber }
        return best
    }

    private enum ReaderError: Error { case notANumber }
}

/// A box's picture as 0-1 floats, height x width x 3, read straight from the
/// PNG's bytes: no colour management, so the values are the ones scored.
private struct Pixels {
    let width: Int, height: Int, rgb: [Float]

    init?(png: Data) {
        guard let source = CGImageSourceCreateWithData(png as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let data = image.dataProvider?.data as Data?,
              image.bitsPerComponent == 8 else { return nil }
        let channels = image.bitsPerPixel / 8, row = image.bytesPerRow
        guard channels >= 1 else { return nil }
        // Where red, green and blue sit in each pixel's bytes, whatever the
        // PNG decoded to: alpha first or last, and byte order reversed or not.
        let alpha = image.alphaInfo
        let alphaFirst = [.first, .premultipliedFirst, .noneSkipFirst].contains(alpha)
        let hasAlpha = alpha != .none
        var at = channels >= 3 ? (hasAlpha && alphaFirst ? [1, 2, 3] : [0, 1, 2]) : [0, 0, 0]
        if channels == 4 && image.bitmapInfo.contains(.byteOrder32Little) { at = at.map { 3 - $0 } }
        let w = image.width, h = image.height
        var rgb = [Float](repeating: 0, count: w * h * 3)
        data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            for y in 0..<h {
                for x in 0..<w {
                    let p = y * row + x * channels
                    for c in 0..<3 { rgb[(y * w + x) * 3 + c] = Float(bytes[p + at[c]]) / 255 }
                }
            }
        }
        width = w
        height = h
        self.rgb = rgb
    }

    /// Half-pixel-centre bilinear resize, no antialiasing (`bilinear` in phone.py).
    func resized(_ oh: Int, _ ow: Int) -> [Float] {
        var out = [Float](repeating: 0, count: oh * ow * 3)
        for oy in 0..<oh {
            let sy = min(max((Double(oy) + 0.5) * Double(height) / Double(oh) - 0.5, 0), Double(height - 1))
            let y0 = Int(sy), y1 = min(y0 + 1, height - 1), fy = Float(sy - Double(y0))
            for ox in 0..<ow {
                let sx = min(max((Double(ox) + 0.5) * Double(width) / Double(ow) - 0.5, 0), Double(width - 1))
                let x0 = Int(sx), x1 = min(x0 + 1, width - 1), fx = Float(sx - Double(x0))
                for c in 0..<3 {
                    let a = rgb[(y0 * width + x0) * 3 + c], b = rgb[(y0 * width + x1) * 3 + c]
                    let d = rgb[(y1 * width + x0) * 3 + c], e = rgb[(y1 * width + x1) * 3 + c]
                    let top = a * (1 - fx) + b * fx, bottom = d * (1 - fx) + e * fx
                    out[(oy * ow + ox) * 3 + c] = top * (1 - fy) + bottom * fy
                }
            }
        }
        return out
    }

    /// Height-by-width-by-channel to channel-first, through `f` per channel.
    private static func planar(_ hwc: [Float], _ h: Int, _ w: Int, _ c: Int, _ f: (Float, Int) -> Float) -> [Float] {
        var out = [Float](repeating: 0, count: h * w * c)
        for ch in 0..<c { for i in 0..<(h * w) { out[ch * h * w + i] = f(hwc[i * 3 + ch], ch) } }
        return out
    }

    /// docTR: fit inside 32 x 128 keeping the shape, zeros to the right and below, then normalise.
    func doctr() -> [Float] {
        let mean: [Float] = [0.694, 0.695, 0.693], std: [Float] = [0.299, 0.296, 0.301]
        // Python's round(): halves to even.
        let s = min(32 / Double(height), 128 / Double(width))
        let oh = max(1, Int((Double(height) * s).rounded(.toNearestOrEven)))
        let ow = max(1, Int((Double(width) * s).rounded(.toNearestOrEven)))
        let small = resized(oh, ow)
        var padded = [Float](repeating: 0, count: 32 * 128 * 3)
        for y in 0..<oh { for x in 0..<ow { for c in 0..<3 { padded[(y * 128 + x) * 3 + c] = small[(y * ow + x) * 3 + c] } } }
        return Self.planar(padded, 32, 128, 3) { ($0 - mean[$1]) / std[$1] }
    }

    /// PaddleOCR: 48 high, width in proportion, (x - 0.5) / 0.5, blue-green-red.
    func paddle() -> ([Float], [Int]) {
        let ow = max(1, Int(48 * Double(width) / Double(height)))
        let r = resized(48, ow)
        return (Self.planar(r, 48, ow, 3) { v, _ in (v - 0.5) / 0.5 }.reversedChannels(48 * ow), [1, 3, 48, ow])
    }

    /// EasyOCR: grey, 64 high, width rounded up in proportion, (x - 0.5) / 0.5.
    func easyocr() -> ([Float], [Int]) {
        let ow = max(1, Int((64 * Double(width) / Double(height)).rounded(.up)))
        let r = resized(64, ow)
        return ((0..<(64 * ow)).map { (r[$0 * 3] - 0.5) / 0.5 }, [1, 1, 64, ow])
    }

    /// TrOCR: stretched to 384 x 384, (x - 0.5) / 0.5.
    func trocr() -> [Float] {
        Self.planar(resized(384, 384), 384, 384, 3) { v, _ in (v - 0.5) / 0.5 }
    }
}

private extension Array where Element == Float {
    /// Channel-first RGB to BGR.
    func reversedChannels(_ plane: Int) -> [Float] {
        Array(self[(2 * plane)...]) + Array(self[plane..<(2 * plane)]) + Array(self[..<plane])
    }
}
