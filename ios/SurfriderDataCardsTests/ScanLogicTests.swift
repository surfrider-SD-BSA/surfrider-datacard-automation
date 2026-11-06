import CoreGraphics
import UIKit
import XCTest

final class ScanLogicTests: XCTestCase {
    private let frame = CGSize(width: 3, height: 4)

    /// Upright, centred, covering `fraction` of the frame across.
    private func quad(width: CGFloat = 0.8, shiftX: CGFloat = 0) -> ScanQuad {
        // A letter card in a 3:4 frame.
        let height = width * 3 * (11.0 / 8.5) / 4
        let x0 = 0.5 - width / 2 + shiftX, x1 = 0.5 + width / 2 + shiftX
        let y0 = 0.5 - height / 2, y1 = 0.5 + height / 2
        return ScanQuad(
            topLeft: CGPoint(x: x0, y: y1), topRight: CGPoint(x: x1, y: y1),
            bottomRight: CGPoint(x: x1, y: y0), bottomLeft: CGPoint(x: x0, y: y0)
        )
    }

    private func print(_ seed: Int) -> PageFingerprint {
        var generator = SeededGenerator(seed: UInt64(seed + 1))
        let count = PageFingerprint.width * PageFingerprint.height
        return PageFingerprint(gray: (0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) })
    }

    // MARK: Position

    func testAWellPlacedCardPasses() {
        XCTAssertNil(ScanPosition.judge(quad(), frame: frame))
    }

    func testACornerOutOfFrameIsCaught() {
        XCTAssertEqual(ScanPosition.judge(quad(shiftX: 0.2), frame: frame), .cornerCutOff)
    }

    func testAFarCardIsCaught() {
        XCTAssertEqual(ScanPosition.judge(quad(width: 0.4), frame: frame), .tooFar)
    }

    func testASidewaysCardIsCaught() {
        // 0.8 of the frame's height across, and a letter card's share of that down.
        let across = 0.7 * 4.0 / 3.0, down = 0.7 * 8.5 / 11.0
        let x0 = 0.5 - across / 2, x1 = 0.5 + across / 2, y0 = 0.5 - down / 2, y1 = 0.5 + down / 2
        let sideways = ScanQuad(
            topLeft: CGPoint(x: x0, y: y1), topRight: CGPoint(x: x1, y: y1),
            bottomRight: CGPoint(x: x1, y: y0), bottomLeft: CGPoint(x: x0, y: y0)
        )
        XCTAssertEqual(ScanPosition.judge(sideways, frame: frame), .sideways)
    }

    func testAKeystonedCardIsCaught() {
        var tilted = quad()
        tilted.topLeft.x += 0.12
        tilted.topRight.x -= 0.12
        XCTAssertEqual(ScanPosition.judge(tilted, frame: frame), .tilted)
    }

    func testATurnedCardIsCaught() {
        let q = quad(width: 0.6)
        func spun(_ p: CGPoint) -> CGPoint {
            let angle = 25.0 * CGFloat.pi / 180
            let x = (p.x - 0.5) * 3, y = (p.y - 0.5) * 4
            return CGPoint(
                x: (x * cos(angle) - y * sin(angle)) / 3 + 0.5,
                y: (x * sin(angle) + y * cos(angle)) / 4 + 0.5
            )
        }
        let turned = ScanQuad(
            topLeft: spun(q.topLeft), topRight: spun(q.topRight),
            bottomRight: spun(q.bottomRight), bottomLeft: spun(q.bottomLeft)
        )
        XCTAssertEqual(ScanPosition.judge(turned, frame: frame), .turned)
    }

    func testTheWrongShapeIsNotACard() {
        var square = quad()
        square.bottomLeft.y += 0.5
        square.bottomRight.y += 0.5
        XCTAssertEqual(ScanPosition.judge(square, frame: frame), .notACard)
    }

    // MARK: Hands-free

    private func seen(_ time: TimeInterval, print: PageFingerprint, quad: ScanQuad? = nil, sharp: Bool = true,
                      problem: CardPositionProblem? = nil) -> AutoCapture.Frame {
        AutoCapture.Frame(time: time, quad: quad ?? self.quad(), problem: problem, isSharp: sharp, fingerprint: print)
    }

    private func empty(_ time: TimeInterval) -> AutoCapture.Frame {
        AutoCapture.Frame(time: time, quad: nil, problem: nil, isSharp: false, fingerprint: nil)
    }

    /// Runs frames of a still card until it shoots, and keeps the picture.
    private func shoot(_ auto: inout AutoCapture, print: PageFingerprint, from start: TimeInterval) -> TimeInterval {
        var time = start
        while time < start + 3 {
            if auto.observe(seen(time, print: print)) == .shoot {
                auto.didKeep(print)
                return time
            }
            time += 0.1
        }
        XCTFail("never took the picture")
        return time
    }

    func testAStillSharpCardIsTakenAfterTheHold() {
        var auto = AutoCapture()
        XCTAssertEqual(auto.observe(seen(0, print: print(1))), .holding(0))
        XCTAssertEqual(auto.observe(seen(AutoCapture.holdSeconds / 2, print: print(1))), .holding(0.5))
        XCTAssertEqual(auto.observe(seen(AutoCapture.holdSeconds, print: print(1))), .shoot)
        XCTAssertEqual(auto.observe(seen(AutoCapture.holdSeconds + 0.1, print: print(1))), .taking)
    }

    func testAMovingCardIsNotTaken() {
        var auto = AutoCapture()
        for step in 0..<40 {
            let moved = quad(shiftX: step.isMultiple(of: 2) ? 0.02 : -0.02)
            XCTAssertNotEqual(auto.observe(seen(Double(step) * 0.1, print: print(1), quad: moved)), .shoot)
        }
    }

    func testABlurryCardIsNotTakenAndSaysSo() {
        var auto = AutoCapture()
        for step in 0..<40 {
            XCTAssertEqual(auto.observe(seen(Double(step) * 0.1, print: print(1), sharp: false)), .blurry)
        }
    }

    func testAProblemIsReportedAndNotTaken() {
        var auto = AutoCapture()
        for step in 0..<40 {
            XCTAssertEqual(auto.observe(seen(Double(step) * 0.1, print: print(1), problem: .sideways)), .problem(.sideways))
        }
    }

    func testTheSamePageIsNotTakenTwice() {
        var auto = AutoCapture()
        let time = shoot(&auto, print: print(1), from: 0)
        for step in 1...60 {
            XCTAssertEqual(auto.observe(seen(time + Double(step) * 0.1, print: print(1))), .waitingForNextPage)
        }
    }

    func testASamePagePutBackIsNotTakenAgain() {
        var auto = AutoCapture()
        var time = shoot(&auto, print: print(1), from: 0)
        for _ in 0..<10 { time += 0.1; _ = auto.observe(empty(time)) }
        for _ in 0..<40 {
            time += 0.1
            XCTAssertEqual(auto.observe(seen(time, print: print(1))), .waitingForNextPage)
        }
    }

    func testACardTurnedOverInPlaceIsTaken() {
        var auto = AutoCapture()
        let time = shoot(&auto, print: print(1), from: 0)
        _ = shoot(&auto, print: print(2), from: time + 0.1)
    }

    /// Two fronts share their print: fairly alike, but not alike enough to be
    /// the same page once the first has left the frame.
    func testANearlyAlikePageCountsOnlyIfTheCardLeft() throws {
        var values = print(1).values
        for index in values.indices where index.isMultiple(of: 5) { values[index] = 0 }
        var gray = [UInt8](repeating: 0, count: values.count)
        let top = values.map(abs).max() ?? 1
        for index in values.indices { gray[index] = UInt8(128 + 127 * values[index] / top) }
        let alike = PageFingerprint(gray: gray)
        let similarity = alike.similarity(to: print(1))
        XCTAssertGreaterThan(similarity, AutoCapture.differentBelow)
        XCTAssertLessThan(similarity, AutoCapture.sameAbove)

        var inPlace = AutoCapture()
        let time = shoot(&inPlace, print: print(1), from: 0)
        XCTAssertEqual(inPlace.observe(seen(time + 0.1, print: alike)), .waitingForNextPage)

        var replaced = AutoCapture()
        var after = shoot(&replaced, print: print(1), from: 0)
        for _ in 0..<5 { after += 0.1; _ = replaced.observe(empty(after)) }
        _ = shoot(&replaced, print: alike, from: after + 0.1)
    }

    func testABlinkIsNotTheCardLeaving() {
        var auto = AutoCapture()
        let time = shoot(&auto, print: print(1), from: 0)
        _ = auto.observe(empty(time + 0.1))
        XCTAssertEqual(auto.observe(seen(time + 0.2, print: print(1))), .waitingForNextPage)
    }

    func testARetakeDoesNotNeedThePageToChange() {
        var auto = AutoCapture()
        let time = shoot(&auto, print: print(1), from: 0)
        auto.didUndo()
        _ = shoot(&auto, print: print(1), from: time + 0.1)
    }

    func testAFailedPictureOfTheFirstPageTriesAgain() {
        var auto = AutoCapture()
        var time = 0.0
        while auto.observe(seen(time, print: print(1))) != .shoot { time += 0.1 }
        auto.didFail()
        _ = shoot(&auto, print: print(1), from: time + 0.1)
    }

    func testAFailedPictureDoesNotRetakeThePageBefore() {
        var auto = AutoCapture()
        var time = shoot(&auto, print: print(1), from: 0)
        time += 0.1
        // The next page shoots, and that picture fails.
        while auto.observe(seen(time, print: print(2))) != .shoot { time += 0.1 }
        auto.didFail()
        // Page 1 is back in view: still not to be taken again.
        XCTAssertEqual(auto.observe(seen(time + 0.1, print: print(1))), .waitingForNextPage)
        // Page 2 is, again.
        _ = shoot(&auto, print: print(2), from: time + 0.2)
    }

    // MARK: Fingerprint

    func testAFingerprintIgnoresBrightness() {
        let gray = (0..<3000).map { UInt8($0 % 200) }
        let brighter = gray.map { $0 + 40 }
        XCTAssertEqual(PageFingerprint(gray: gray).similarity(to: PageFingerprint(gray: brighter)), 1, accuracy: 0.001)
    }

    func testAFingerprintKnowsAPageUpsideDown() {
        let gray = (0..<3000).map { UInt8($0 % 200) }
        let flipped = Array(gray.reversed())
        XCTAssertEqual(PageFingerprint(gray: gray).similarity(to: PageFingerprint(gray: flipped)), 1, accuracy: 0.001)
    }

    func testShrinkingAverages() {
        XCTAssertEqual(PageMeasures.shrunk(gray: [0, 100, 50, 150], width: 2, height: 2, toWidth: 1, toHeight: 1), [75])
    }

    // MARK: Page count

    func testPageCountSaysWhatComesNext() {
        XCTAssertEqual(ScanPageCount.nextStep(0), "Now the front of card 1")
        XCTAssertEqual(ScanPageCount.nextStep(1), "Now the back of card 1")
        XCTAssertEqual(ScanPageCount.nextStep(2), "Now the front of card 2")
        XCTAssertFalse(ScanPageCount.isOdd(24))
        XCTAssertTrue(ScanPageCount.isOdd(25))
        XCTAssertEqual(ScanPageCount.nextStep(25), "Now the back of card 13")
    }

    // MARK: Page store

    private func tempStore() -> ScanPageStore {
        ScanPageStore(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    }

    private func jpeg(_ tone: CGFloat, width: CGFloat = 20) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: 20), format: format)
            .jpegData(withCompressionQuality: 0.9) { context in
                UIColor(white: tone, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: 0, width: width, height: 20))
            }
    }

    func testPagesGoPastTheOldLimitInOrder() throws {
        let store = tempStore()
        // Past Apple's 24, and past where names sort differently from numbers.
        for index in 1...120 { XCTAssertEqual(try store.append(jpeg(0.5, width: CGFloat(index))), index) }
        XCTAssertEqual(store.count, 120)
        for index in stride(from: 0, to: 120, by: 17) {
            XCTAssertEqual(store.image(at: index)?.size.width, CGFloat(index + 1))
        }
    }

    func testRetakingKeepsTheOrder() throws {
        let store = tempStore()
        try store.append(jpeg(0.5, width: 1))
        try store.append(jpeg(0.5, width: 2))
        XCTAssertEqual(store.removeLast(), 1)
        try store.append(jpeg(0.5, width: 3))
        XCTAssertEqual(store.image(at: 0)?.size.width, 1)
        XCTAssertEqual(store.image(at: 1)?.size.width, 3)
    }

    func testPagesSurviveTheAppGoingAway() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try ScanPageStore(root: root).append(jpeg(0.5))
        try ScanPageStore(root: root).append(jpeg(0.5))
        XCTAssertEqual(ScanPageStore(root: root).count, 2)
    }

    func testAnEmptyStoreIsFine() {
        let store = tempStore()
        XCTAssertEqual(store.count, 0)
        XCTAssertEqual(store.removeLast(), 0)
        XCTAssertNil(store.image(at: 0))
        store.clear()
    }
}

private struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state ^ (state >> 29)
    }
}
