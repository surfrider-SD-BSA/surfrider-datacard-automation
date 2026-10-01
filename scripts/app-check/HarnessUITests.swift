import XCTest

/// Reads a scan in the iOS app and records what the review screen says about named boxes.
///
/// Run by scripts/app-check/ios.sh, which builds the app, leaves the scan in the App
/// Group drawer the way the share extension does, and passes two settings through
/// xcodebuild's TEST_RUNNER_ prefix:
///
///   TARGETS  "4|Cigarette Butts;4|Plastic Straws" -- card number and item name
///   OUT      a directory on the Mac for log.txt and a screenshot of each box
///
/// It walks the screens a volunteer does -- the event, the waiting scan, the reading,
/// "Start checking", "All cards" -- and for each target taps its row and writes down
/// every text on the review screen: the tag ("counted: check it"), the number in the
/// box, which cell of how many. A box the tool took as read is not on the list, and
/// is logged as MISSING.
final class HarnessUITests: XCTestCase {
    private var out: URL!
    private var log = ""

    override func setUp() {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        out = URL(fileURLWithPath: env["OUT"] ?? NSTemporaryDirectory())
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    }

    private func note(_ s: String) {
        log += s + "\n"
        try? log.write(to: out.appendingPathComponent("log.txt"), atomically: true, encoding: .utf8)
    }

    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let file = name.replacingOccurrences(of: "/", with: "-")
        try? png.write(to: out.appendingPathComponent("\(file).png"))
        let a = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        a.name = file
        a.lifetime = .keepAlways
        add(a)
    }

    /// Every element on screen, from one snapshot. Querying elements one at a time
    /// costs a round trip each, and a list is scrolled through hundreds of them.
    private func flat(_ app: XCUIApplication) -> [XCUIElementSnapshot] {
        guard let root = try? app.snapshot() else { return [] }
        var out: [XCUIElementSnapshot] = []
        var stack: [XCUIElementSnapshot] = [root]
        while let n = stack.popLast() {
            out.append(n)
            stack.append(contentsOf: n.children.reversed())
        }
        return out
    }

    private func texts(_ app: XCUIApplication) -> [String] {
        flat(app).filter { $0.elementType == .staticText }.map { $0.label }
    }

    func testReadAndInspect() throws {
        let env = ProcessInfo.processInfo.environment
        let targets: [(card: Int, item: String)] = (env["TARGETS"] ?? "").split(separator: ";").compactMap {
            let parts = $0.split(separator: "|", maxSplits: 1).map(String.init)
            guard parts.count == 2, let card = Int(parts[0]) else { return nil }
            return (card, parts[1])
        }

        let app = XCUIApplication(bundleIdentifier: "com.mateobesse.surfriderdatacards")
        app.launch()

        // Screen 2: the waiting scan starts a cleanup. The date defaults to today; a beach is needed.
        let beach = app.textFields.element(boundBy: 0)
        XCTAssertTrue(beach.waitForExistence(timeout: 60), "no event screen: is the scan in the drawer?")
        beach.tap()
        beach.typeText("App Check Beach\n")
        let scan = app.buttons["Scan the cards"]
        XCTAssertTrue(scan.waitForExistence(timeout: 10))
        scan.tap()

        // Screen 3: the waiting scan.
        let read = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Read '")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 30), "no waiting scan")
        note("capture: \(read.label)")
        read.tap()

        // Screen 4: reading.
        let start = app.buttons["Start checking"]
        let began = Date()
        XCTAssertTrue(start.waitForExistence(timeout: 1800), "reading did not finish: \(texts(app))")
        note("read in \(Int(Date().timeIntervalSince(began)))s")
        shot("reading-done")
        start.tap()

        // Screen 6, then 7: every box on the review list.
        let all = app.buttons["All cards"]
        XCTAssertTrue(all.waitForExistence(timeout: 30))
        note("review first: \(texts(app))")
        all.tap()
        XCTAssertTrue(app.buttons["Make the spreadsheet"].waitForExistence(timeout: 30))
        note("cards header: \(texts(app).prefix(4))")

        for t in targets {
            let tag = "C\(t.card)"
            guard let row = find(app, tag: tag, item: t.item) else {
                note("MISSING \(tag) \(t.item): not on the review list")
                shot("missing-\(tag)-\(t.item.prefix(20))")
                scrollToTop(app)
                continue
            }
            note("row \(tag) \(t.item): \(row.label)")

            // A row near the bottom sits under the pinned button, and one near the top
            // under the header. Drag it to the middle first, holding at the end so the
            // list does not fling it past.
            var at = row.at
            let h = app.windows.firstMatch.frame.height
            let top = app.scrollViews.firstMatch.frame.minY + 40
            var tries = 0
            while (at.y > h * 0.62 || at.y < top) && tries < 6 {
                let origin = app.coordinate(withNormalizedOffset: .zero)
                let from = min(max(at.y, top), h * 0.72)
                origin.withOffset(CGVector(dx: 200, dy: from)).press(
                    forDuration: 0.1,
                    thenDragTo: origin.withOffset(CGVector(dx: 200, dy: from + (h * 0.45 - at.y))),
                    withVelocity: 200,
                    thenHoldForDuration: 0.6)
                sleep(1)
                guard let again = find(app, tag: tag, item: t.item) else { break }
                at = again.at
                tries += 1
            }
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: at.x, dy: at.y)).tap()

            let back = app.buttons["Back"]
            XCTAssertTrue(back.waitForExistence(timeout: 10), "\(tag) \(t.item): the tap did not open it")
            // The pictures arrive a moment after the screen: wait for the spinners to go.
            let waiting = Date()
            while app.activityIndicators.count > 0 && Date().timeIntervalSince(waiting) < 20 { usleep(300_000) }
            sleep(1)
            note("review \(tag) \(t.item): \(texts(app))")
            shot("review-\(tag)-\(t.item.prefix(20))")
            back.tap()
            XCTAssertTrue(app.buttons["Make the spreadsheet"].waitForExistence(timeout: 10))
            scrollToTop(app)
        }
    }

    /// Where the row for this card and item is on screen, scrolling the list until it shows.
    private func find(_ app: XCUIApplication, tag: String, item: String) -> (label: String, at: CGPoint)? {
        let list = app.scrollViews.firstMatch
        let screen = app.windows.firstMatch.frame
        var lastSeen = ""
        for _ in 0..<300 {
            let visible = flat(app).filter {
                !$0.frame.isEmpty && screen.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY))
            }
            // A row is one button labelled "C4, Cigarette Butts, Common & Priority Items, 4".
            // Item names hold commas of their own, so the label is matched from the front.
            for b in visible where b.elementType == .button && b.label.hasPrefix("\(tag), \(item), ") {
                return (b.label, CGPoint(x: b.frame.midX, y: b.frame.midY))
            }
            let seen = visible.filter { $0.elementType == .staticText }.map(\.label).joined(separator: "|")
            if seen == lastSeen { return nil }
            lastSeen = seen
            list.swipeUp(velocity: 1200)
        }
        return nil
    }

    private func scrollToTop(_ app: XCUIApplication) {
        let list = app.scrollViews.firstMatch
        var lastSeen = ""
        for _ in 0..<200 {
            let seen = texts(app).joined(separator: "|")
            if seen == lastSeen { return }
            lastSeen = seen
            list.swipeDown(velocity: .fast)
            list.swipeDown(velocity: .fast)
        }
    }
}
