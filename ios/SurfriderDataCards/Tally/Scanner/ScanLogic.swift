//
//  The decisions behind the card scanner, with no camera in them.
//
//  Everything here takes numbers and gives back a decision, so all of it can
//  be tested on a machine with no camera. The thresholds marked UNMEASURED were
//  set from the printed blank cards in assets/reference and have never seen a
//  real photograph; a real-card test is what can move them.
//

import CoreGraphics
import Foundation

/// A card's four corners, as fractions of the frame, origin at the lower left
/// (the convention of both Vision and Core Image).
struct ScanQuad: Equatable {
    var topLeft: CGPoint
    var topRight: CGPoint
    var bottomRight: CGPoint
    var bottomLeft: CGPoint

    var corners: [CGPoint] { [topLeft, topRight, bottomRight, bottomLeft] }

    /// How far the corner that moved most has moved, as a fraction of the frame.
    func movement(from other: ScanQuad) -> CGFloat {
        zip(corners, other.corners)
            .map { hypot($0.x - $1.x, $0.y - $1.y) }
            .max() ?? 0
    }

    /// The share of the frame the card covers.
    var area: CGFloat {
        let points = corners
        var twice: CGFloat = 0
        for index in points.indices {
            let a = points[index], b = points[(index + 1) % points.count]
            twice += a.x * b.y - b.x * a.y
        }
        return abs(twice) / 2
    }

    /// Edge lengths in pixels: a fraction of a 3:4 frame's width is not the
    /// same distance as that fraction of its height.
    func edges(in frame: CGSize) -> (top: CGFloat, bottom: CGFloat, left: CGFloat, right: CGFloat) {
        func length(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
            hypot((a.x - b.x) * frame.width, (a.y - b.y) * frame.height)
        }
        return (
            length(topLeft, topRight), length(bottomLeft, bottomRight),
            length(topLeft, bottomLeft), length(topRight, bottomRight)
        )
    }

    /// The card's long edge over its short edge, as well as the corners can say.
    func aspect(in frame: CGSize) -> CGFloat {
        let e = edges(in: frame)
        let across = (e.top + e.bottom) / 2, down = (e.left + e.right) / 2
        guard min(across, down) > 0 else { return 0 }
        return max(across, down) / min(across, down)
    }
}

/// What is wrong with where the card is, before a picture is taken.
enum CardPositionProblem: Equatable {
    case cornerCutOff, tooFar, sideways, tilted, turned, notACard

    var message: String {
        switch self {
        case .cornerCutOff: return "Get all four corners in"
        case .tooFar: return "Move closer to the card"
        case .sideways: return "The card is sideways. Turn it upright"
        case .tilted: return "Hold the phone straight above the card"
        case .turned: return "Straighten the card"
        case .notACard: return "Can't see the whole card"
        }
    }
}

/// The sideways and out-of-position check that can run on every frame.
///
/// This is NOT `ruleOverlap` or the banner check from `src/lib/register.ts`.
/// Those need a page already fitted to the template inside the JavaScript
/// engine, which has no one-page entry point, and a page that does not fit
/// takes every retry before it is refused. The reader still runs them on every
/// page afterwards and offers a retake. This looks only at the corners.
enum ScanPosition {
    /// Closer to the frame's edge than this and the corner may be outside it.
    static let edgeMargin: CGFloat = 0.012
    /// Below about this share, a 12 MP photo has fewer than the 200 DPI the
    /// reader wants across the card's short edge.
    static let minimumArea: CGFloat = 0.30
    /// UNMEASURED. How much shorter one edge may look than the one opposite.
    static let maximumTaper: CGFloat = 0.25
    /// UNMEASURED. How far the card may be turned in the frame.
    static let maximumTurnDegrees: CGFloat = 15
    /// A letter card is 1.29. Wide, because tilt distorts what corners measure:
    /// at the most taper allowed above, a card can measure about 1.55.
    static let cardAspects: ClosedRange<CGFloat> = 1.10...1.65

    static func judge(_ quad: ScanQuad, frame: CGSize) -> CardPositionProblem? {
        for corner in quad.corners {
            if corner.x < edgeMargin || corner.x > 1 - edgeMargin
                || corner.y < edgeMargin || corner.y > 1 - edgeMargin {
                return .cornerCutOff
            }
        }
        if !cardAspects.contains(quad.aspect(in: frame)) { return .notACard }

        let e = quad.edges(in: frame)
        if (e.top + e.bottom) > (e.left + e.right) { return .sideways }

        let dx = (quad.topRight.x - quad.topLeft.x) * frame.width
        let dy = (quad.topRight.y - quad.topLeft.y) * frame.height
        if abs(atan2(dy, dx) * 180 / .pi) > maximumTurnDegrees { return .turned }

        func taper(_ a: CGFloat, _ b: CGFloat) -> CGFloat { 1 - min(a, b) / max(max(a, b), 1) }
        if max(taper(e.top, e.bottom), taper(e.left, e.right)) > maximumTaper { return .tilted }

        if quad.area < minimumArea { return .tooFar }
        return nil
    }
}

/// A small picture of a page, for telling whether the page has changed.
struct PageFingerprint: Equatable {
    static let width = 48
    static let height = 62

    /// Zero mean and unit length, so a brighter frame of the same page matches.
    let values: [Float]

    /// `gray` holds `width` x `height` pixels, already turned portrait.
    init(gray: [UInt8]) {
        let mean = gray.reduce(Float(0)) { $0 + Float($1) } / Float(max(gray.count, 1))
        let centred = gray.map { Float($0) - mean }
        let length = centred.reduce(Float(0)) { $0 + $1 * $1 }.squareRoot()
        values = length > 0 ? centred.map { $0 / length } : centred
    }

    /// 1 for the same picture, near 0 for unrelated ones. Also tried turned
    /// half way round: the same side laid upside down is still the same side.
    func similarity(to other: PageFingerprint) -> Float {
        guard values.count == other.values.count else { return 0 }
        var ahead: Float = 0, turned: Float = 0
        let last = values.count - 1
        for index in values.indices {
            ahead += values[index] * other.values[index]
            turned += values[index] * other.values[last - index]
        }
        return max(ahead, turned)
    }
}

/// Measurements of a flattened page, on its gray pixels.
enum PageMeasures {
    /// UNMEASURED ON PHOTOS. From the blank cards at 200 DPI: sharp scores
    /// 0.49-0.72, a blur of 2 pixels 0.036-0.064, of 4 pixels 0.006-0.011. Set
    /// low, because too high stops hands-free capture altogether and the
    /// shutter then has to do its job. See testSharpnessSeparatesBlur.
    static let minimumSharpness = 0.03

    /// Fine detail over overall contrast, so a dim page is not called blurry.
    /// Meant for a page drawn at `PageFlattener.measureWidth`, which is what
    /// makes a score from a preview frame comparable with one from a photo.
    static func sharpness(gray: [UInt8], width: Int, height: Int) -> Double {
        guard width > 2, height > 2, gray.count == width * height else { return 0 }
        return gray.withUnsafeBufferPointer { p -> Double in
            var edge = 0.0, edgeSquared = 0.0, level = 0.0, levelSquared = 0.0
            for y in 1..<(height - 1) {
                let row = y * width
                for x in 1..<(width - 1) {
                    let i = row + x
                    let centre = Double(p[i])
                    let laplacian = Double(p[i - 1]) + Double(p[i + 1])
                        + Double(p[i - width]) + Double(p[i + width]) - 4 * centre
                    edge += laplacian
                    edgeSquared += laplacian * laplacian
                    level += centre
                    levelSquared += centre * centre
                }
            }
            let n = Double((width - 2) * (height - 2))
            let edgeVariance = edgeSquared / n - (edge / n) * (edge / n)
            let levelVariance = levelSquared / n - (level / n) * (level / n)
            return edgeVariance / (levelVariance + 1)
        }
    }

    /// Each new pixel the average of the pixels it covers.
    static func shrunk(gray: [UInt8], width: Int, height: Int, toWidth: Int, toHeight: Int) -> [UInt8] {
        guard gray.count == width * height, toWidth > 0, toHeight > 0 else { return [] }
        var out = [UInt8](repeating: 0, count: toWidth * toHeight)
        for y in 0..<toHeight {
            let y0 = y * height / toHeight, y1 = max(y0 + 1, (y + 1) * height / toHeight)
            for x in 0..<toWidth {
                let x0 = x * width / toWidth, x1 = max(x0 + 1, (x + 1) * width / toWidth)
                var sum = 0
                for row in y0..<y1 {
                    for column in x0..<x1 { sum += Int(gray[row * width + column]) }
                }
                out[y * toWidth + x] = UInt8(sum / ((y1 - y0) * (x1 - x0)))
            }
        }
        return out
    }

    enum Side: Equatable {
        case front, back
        var name: String { self == .front ? "front" : "back" }
    }

    /// Which side a page looks like: the first signal of `classifyPage` in
    /// `src/lib/register.ts`, carried over unchanged. The back opens with
    /// full-width dark banners at 4-6% down the page. Only a hint, there as in
    /// here, and it assumes the page is the right way up.
    static func side(gray: [UInt8], width: Int, height: Int) -> Side {
        let x0 = Int((Double(width) * 0.05).rounded(.down))
        let x1 = min(width, Int((Double(width) * 0.95).rounded(.up)))
        let y0 = Int((Double(height) * 0.04).rounded(.down))
        let y1 = min(height, Int((Double(height) * 0.06).rounded(.up)))
        guard x1 > x0, y1 > y0, gray.count == width * height else { return .front }
        var dark = 0
        for y in y0..<y1 {
            for x in x0..<x1 where gray[y * width + x] < 150 { dark += 1 }
        }
        return Double(dark) / Double((x1 - x0) * (y1 - y0)) > 0.45 ? .back : .front
    }
}

/// What the page count means, one card being a front and a back.
enum ScanPageCount {
    static func isOdd(_ pages: Int) -> Bool { !pages.isMultiple(of: 2) }

    static func summary(_ pages: Int) -> String {
        if pages == 0 { return "No pages yet" }
        return "\(pages) \(pages == 1 ? "page" : "pages")"
    }

    /// What to scan next, assuming the pile is front, back, front, back.
    static func nextStep(_ pages: Int) -> String {
        let card = pages / 2 + 1
        return isOdd(pages) ? "Now the back of card \(card)" : "Now the front of card \(card)"
    }

    /// Said when two pages in a row look like the same side. A hint, as
    /// `PageMeasures.side` is.
    static func repeatedSide(_ side: PageMeasures.Side) -> String {
        "Two \(side.name)s in a row. Check a card isn't missing a side"
    }

    static let oddWarning = "That's an odd number of pages, so a card is missing a side."
}

/// When to take the picture by itself.
///
/// Fed one frame at a time, and holds off until the card has stayed still and
/// sharp for a moment. After a picture it waits for the page to change, so the
/// same side is not taken twice.
struct AutoCapture {
    struct Frame {
        var time: TimeInterval
        var quad: ScanQuad?
        var problem: CardPositionProblem?
        var isSharp: Bool
        var fingerprint: PageFingerprint?
    }

    enum Status: Equatable {
        case lookingForCard
        case problem(CardPositionProblem)
        case blurry
        /// Still and sharp; 0 to 1 of the way to taking the picture.
        case holding(Double)
        case shoot
        case taking
        case waitingForNextPage
    }

    /// How long the card must stay still. Long enough for a hand to leave.
    static let holdSeconds: TimeInterval = 0.8
    /// How far a corner may wander during that, as a fraction of the frame.
    static let steadyMovement: CGFloat = 0.012
    /// How much the page may change during that.
    static let steadySimilarity: Float = 0.95
    /// UNMEASURED. Below this the page has plainly changed, even if it never
    /// left the frame: a card turned over in place.
    static let differentBelow: Float = 0.80
    /// UNMEASURED. Two fronts share all their print, so the next card's front
    /// looks a lot like this one: on the blank front, 0.967 with writing added,
    /// and 0.965 for the same page found 12 pixels differently. This check
    /// cannot tell those apart. So a card that left the frame and came back
    /// counts as a new page unless it is all but identical, since a stall is
    /// worse than a repeat: the repeat shows as "two fronts in a row" and has a
    /// Retake button.
    static let sameAbove: Float = 0.985
    /// How long the frame must be empty to count as the card having left.
    static let leftAfterSeconds: TimeInterval = 0.3

    private enum Phase {
        case seeking
        case holding(since: TimeInterval, quad: ScanQuad, fingerprint: PageFingerprint)
        case taking
        case waiting(for: PageFingerprint, left: Bool, emptySince: TimeInterval?)
    }

    private var phase = Phase.seeking
    /// The page last kept, for when a picture is undone or fails.
    private var kept: PageFingerprint?

    mutating func observe(_ frame: Frame) -> Status {
        switch phase {
        case .taking:
            return .taking

        case .waiting(let captured, var left, var emptySince):
            guard let print = frame.fingerprint else {
                let since = emptySince ?? frame.time
                emptySince = since
                if frame.time - since >= Self.leftAfterSeconds { left = true }
                phase = .waiting(for: captured, left: left, emptySince: emptySince)
                return .waitingForNextPage
            }
            let similarity = print.similarity(to: captured)
            let changed = similarity < Self.differentBelow || (left && similarity < Self.sameAbove)
            guard changed else {
                phase = .waiting(for: captured, left: left, emptySince: nil)
                return .waitingForNextPage
            }
            phase = .seeking
            return seek(frame)

        case .seeking, .holding:
            return seek(frame)
        }
    }

    private mutating func seek(_ frame: Frame) -> Status {
        guard let quad = frame.quad else {
            phase = .seeking
            return .lookingForCard
        }
        if let problem = frame.problem {
            phase = .seeking
            return .problem(problem)
        }
        guard frame.isSharp, let print = frame.fingerprint else {
            phase = .seeking
            return .blurry
        }
        if case .holding(let since, let held, let heldPrint) = phase,
           quad.movement(from: held) <= Self.steadyMovement,
           print.similarity(to: heldPrint) >= Self.steadySimilarity {
            let progress = (frame.time - since) / Self.holdSeconds
            if progress >= 1 {
                phase = .taking
                return .shoot
            }
            return .holding(progress)
        }
        phase = .holding(since: frame.time, quad: quad, fingerprint: print)
        return .holding(0)
    }

    /// A picture is on its way, from this or from the shutter.
    mutating func willTake() { phase = .taking }

    /// The picture was kept: now wait for the page to change.
    mutating func didKeep(_ fingerprint: PageFingerprint) {
        kept = fingerprint
        phase = .waiting(for: fingerprint, left: false, emptySince: nil)
    }

    /// The picture was not kept, so this page has not been taken after all.
    mutating func didFail() {
        if let kept {
            phase = .waiting(for: kept, left: true, emptySince: nil)
        } else {
            phase = .seeking
        }
    }

    /// The last page was thrown away, so the page in view may be taken again.
    /// Forgets rather than remembers, so a retake does not have to change page.
    mutating func didUndo() {
        kept = nil
        phase = .seeking
    }
}
