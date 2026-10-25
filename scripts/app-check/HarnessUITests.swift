import XCTest

/// Reads a scan in the iOS app and records what the review screen says about named boxes.
///
/// Run by scripts/app-check/ios.sh, which builds the app, leaves the scan in the App
/// Group drawer the way the share extension does, and passes two settings through
/// xcodebuild's TEST_RUNNER_ prefix:
///
///   TARGETS  one "card|item|section" per line, as scripts/app-check/targets.py writes them
///   OUT      a directory on the Mac for log.txt and a screenshot of each box
///
/// It walks the screens a volunteer does -- the event, the waiting scan, the reading,
/// "Start checking", "All cards" -- and for each target taps its row and writes down
/// every text on the review screen: the tag ("counted: check it"), the number in the
/// box, which cell of how many. A box that is not on the list -- taken as read, or
/// never offered -- is logged as NOT ON THE LIST.
final class HarnessUITests: XCTestCase {
    /// The app refuses a beach and date already sent, so each run names its
    /// own: the time it started.
    static let runTag: String = {
        let f = DateFormatter()
        f.dateFormat = "HHmmss"
        return f.string(from: Date())
    }()

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
        if (env["WORKFLOW"] ?? "0") != "0" { return }
        if (env["DRIVE"] ?? "0") != "0" { return }
        // One per line: an item name can hold a ";" ("Treated Wood (i.e. pallets; NOT
        // driftwood)"), and six share a name, told apart by their section.
        var targets: [(card: Int, item: String, section: String)] = []
        for line in (env["TARGETS"] ?? "").split(separator: "\n") {
            let parts = line.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 3, let card = Int(parts[0]) else {
                XCTFail("a target that is not card|item|section: \(line)")
                return
            }
            targets.append((card, parts[1], parts[2]))
        }
        XCTAssertFalse(targets.isEmpty, "no targets")

        let app = XCUIApplication(bundleIdentifier: "com.mateobesse.surfriderdatacards")
        app.launch()

        // Screen 2: the waiting scan starts a cleanup. The date defaults to today; a beach is needed.
        let beach = app.textFields.element(boundBy: 0)
        XCTAssertTrue(beach.waitForExistence(timeout: 60), "no event screen: is the scan in the drawer?")
        beach.tap()
        beach.typeText("App Check Beach \(Self.runTag)\n")
        let scan = app.buttons["Scan the cards"]
        XCTAssertTrue(scan.waitForExistence(timeout: 10))
        scan.tap()

        // Screen 3: the waiting scan.
        let read = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Read '")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 30), "no waiting scan")
        note("capture: \(read.label)")
        // Whether this build has the chapter's Google settings (ios/Drive.xcconfig).
        note("capture: Choose from Drive \(app.buttons["Choose from Google Drive"].exists ? "shown" : "NOT SHOWN")")
        shot("capture")
        read.tap()

        // Screen 4: reading. It ends in "Start checking", or in a scan that could not
        // be read, or in a page refused -- and the last two are answers too. So are
        // "Try another scan" (nothing written found) and "See the cards" (nothing
        // left to check), which go on to the cards list without the review screen.
        let start = app.buttons["Start checking"]
        let failed = app.staticTexts["That scan could not be read."]
        let refused = app.buttons["Look at that page first"]
        let nothing = app.buttons["Try another scan"]
        let cardsOnly = app.buttons["See the cards"]
        let began = Date()
        while !start.exists && !cardsOnly.exists && Date().timeIntervalSince(began) < 1800 {
            if nothing.exists && !failed.exists {
                shot("nothing-found")
                note("NOTHING FOUND: \(texts(app))")
                return
            }
            if failed.exists || refused.exists {
                shot("reading-refused")
                note("READ REFUSED: \(texts(app))")
                XCTFail("the scan was not read: \(texts(app))")
                return
            }
            sleep(2)
        }
        XCTAssertTrue(start.exists || cardsOnly.exists, "reading did not finish in 30 minutes: \(texts(app))")
        note("read in \(Int(Date().timeIntervalSince(began)))s")
        shot("reading-done")
        if cardsOnly.exists {
            note("NOTHING TO CHECK: \(texts(app))")
            cardsOnly.tap()
        } else {
            start.tap()

            // Screen 6, then 7: every box on the review list.
            let all = app.buttons["All cards"]
            XCTAssertTrue(all.waitForExistence(timeout: 30))
            note("review first: \(texts(app))")
            all.tap()
        }
        XCTAssertTrue(app.buttons["Make the spreadsheet"].waitForExistence(timeout: 30))
        note("cards header: \(texts(app).prefix(4))")

        for t in targets {
            let tag = "C\(t.card)"
            guard let row = find(app, tag: tag, item: t.item, section: t.section) else {
                XCTAssertTrue(app.buttons["Make the spreadsheet"].exists, "lost the All cards list looking for \(tag) \(t.item)")
                note("NOT ON THE LIST \(tag) \(t.item) (\(t.section)): taken as read, or never offered")
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
                guard let again = find(app, tag: tag, item: t.item, section: t.section) else { break }
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

        // EXPORT: make the spreadsheet as the list stands. ios.sh copies the file out of
        // the app's temporary directory afterwards.
        if env["EXPORT"] == "1" {
            app.buttons["Make the spreadsheet"].tap()
            let make = app.buttons["Make the spreadsheet"]
            XCTAssertTrue(make.waitForExistence(timeout: 10), "no finish screen")
            make.tap()
            let ready = app.staticTexts["Ready to send"]
            XCTAssertTrue(ready.waitForExistence(timeout: 120), "no spreadsheet: \(texts(app))")
            note("exported: \(texts(app))")
            shot("exported")
        }
    }

    /// DRIVE=1: "Choose from Google Drive" with no Google account. Opens the
    /// chapter's folder (GOOGLE_DRIVE_FOLDER_ID), goes down to "Not entered",
    /// opens the first scan and waits for it to be read.
    func testDriveFolder() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["DRIVE"] == "1" else { return }
        let app = XCUIApplication(bundleIdentifier: "com.mateobesse.surfriderdatacards")
        app.launch()

        let beach = app.textFields.element(boundBy: 0)
        XCTAssertTrue(beach.waitForExistence(timeout: 60), "no event screen")
        beach.tap()
        beach.typeText("Drive Beach \(Self.runTag)\n")
        app.buttons["Scan the cards"].tap()

        let drive = app.buttons["Choose from Google Drive"]
        XCTAssertTrue(drive.waitForExistence(timeout: 30), "no Drive button: \(texts(app))")
        drive.tap()
        for folder in ["Scanned Data Cards", "Not entered"] {
            let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", folder)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 30), "no \(folder): \(texts(app))")
            note("drive: \(texts(app))")
            shot("drive-\(folder.prefix(8))")
            row.tap()
        }
        let pdf = app.buttons.matching(NSPredicate(format: "label CONTAINS '.pdf'")).firstMatch
        XCTAssertTrue(pdf.waitForExistence(timeout: 30), "no PDFs: \(texts(app))")
        note("drive pdfs: \(texts(app))")
        shot("drive-pdfs")
        note("opening \(pdf.label)")
        pdf.tap()

        let start = app.buttons["Start checking"]
        XCTAssertTrue(start.waitForExistence(timeout: 900), "never read: \(texts(app))")
        note("read from Drive: \(texts(app))")
        shot("drive-read")
    }

    /// WORKFLOW=1: what a volunteer does besides reading. Leaves the app while it reads
    /// and comes back; corrects three boxes on the keypad (a typed number, "Nothing
    /// there", a typed number fixed with the delete key); quits the app mid-review and
    /// picks up the draft; checks the three on the All cards list; makes the
    /// spreadsheet. Each step is logged, and a step that goes wrong fails the test.
    func testWorkflow() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORKFLOW"] == "1" else { return }
        let app = XCUIApplication(bundleIdentifier: "com.mateobesse.surfriderdatacards")
        app.launch()

        let beach = app.textFields.element(boundBy: 0)
        XCTAssertTrue(beach.waitForExistence(timeout: 60), "no event screen: is the scan in the drawer?")
        beach.tap()
        beach.typeText("Workflow Beach \(Self.runTag)\n")
        XCTAssertTrue(app.buttons["Scan the cards"].waitForExistence(timeout: 10))
        app.buttons["Scan the cards"].tap()
        let read = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Read '")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 30), "no waiting scan")
        read.tap()

        // Leave while it reads, and come back.
        sleep(3)
        note("before leaving: \(texts(app))")
        XCUIDevice.shared.press(.home)
        sleep(20)
        app.activate()
        sleep(2)
        note("back after 20 s away: \(texts(app))")
        shot("wf-back")

        let start = app.buttons["Start checking"]
        let failed = app.staticTexts["That scan could not be read."]
        let began = Date()
        while !start.exists && Date().timeIntervalSince(began) < 1800 {
            if failed.exists || app.buttons["Look at that page first"].exists || app.buttons["Try another scan"].exists {
                shot("wf-stopped")
                note("READING STOPPED: \(texts(app))")
                XCTFail("reading did not finish after leaving the app: \(texts(app))")
                return
            }
            sleep(2)
        }
        XCTAssertTrue(start.exists, "reading did not finish: \(texts(app))")
        note("read in \(Int(Date().timeIntervalSince(began)))s after coming back")
        start.tap()
        XCTAssertTrue(app.buttons["All cards"].waitForExistence(timeout: 30))

        // Three corrections. The review screen's texts are: Back, "Card c",
        // "of n · side · page p", "Cell n of m", "Column X in the sheet", item,
        // section, tag, hint, the number, Next.
        func current() -> (card: Int, item: String, section: String, label: String) {
            let t = texts(app)
            let cardText = t.first { $0.hasPrefix("Card ") } ?? ""
            let card = Int(cardText.dropFirst(5).prefix { $0.isNumber }) ?? 0
            let i = t.firstIndex { $0.hasPrefix("Column ") } ?? 0
            let item = i + 1 < t.count ? t[i + 1] : ""
            let section = i + 2 < t.count ? t[i + 2] : ""
            return (card, item, section, t.first { $0.hasPrefix("Cell ") } ?? "")
        }
        func press(_ keys: [String]) {
            for k in keys {
                // The delete key is an SF Symbol with no text: it is the key right of "0".
                if k == "<" {
                    let zero = app.buttons["0"].frame
                    app.coordinate(withNormalizedOffset: .zero)
                        .withOffset(CGVector(dx: zero.maxX + 8 + zero.width / 2, dy: zero.midY)).tap()
                } else {
                    XCTAssertTrue(app.buttons[k].exists, "no key \(k): \(texts(app))")
                    app.buttons[k].tap()
                }
                usleep(200_000)
            }
        }
        func next() {
            let b = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Next' OR label BEGINSWITH 'Done'")).firstMatch
            XCTAssertTrue(b.isEnabled, "Next is disabled: \(texts(app))")
            b.tap(); sleep(1)
        }
        var expected: [(card: Int, item: String, section: String, value: Int)] = []
        var c = current()
        note("cell A \(c.label): card \(c.card) \(c.item) (\(c.section)): \(texts(app))")
        press(["C", "7", "7"]); shot("wf-typed-77"); next()
        expected.append((c.card, c.item, c.section, 77))
        c = current()
        note("cell B \(c.label): card \(c.card) \(c.item) (\(c.section))")
        app.buttons["Nothing there"].tap(); sleep(1)
        expected.append((c.card, c.item, c.section, 0))
        c = current()
        note("cell C \(c.label): card \(c.card) \(c.item) (\(c.section))")
        press(["C", "1", "2", "3", "<"]); shot("wf-typed-12"); next()
        expected.append((c.card, c.item, c.section, 12))
        note("now at: \(current().label)")

        // The three, for the second run (WORKFLOW=2). Beside the run's own directory,
        // which ios.sh empties at the start of every run.
        let expect = out.deletingLastPathComponent().appendingPathComponent("workflow-expect.txt")
        try? expected.map { "\($0.card)|\($0.item)|\($0.section)|\($0.value)" }
            .joined(separator: "\n").write(to: expect, atomically: true, encoding: .utf8)

        // Quit mid-review, as a phone does to a backgrounded app.
        sleep(2) // the draft is saved 400 ms after a change
        app.terminate()
        app.launch()
        let resume = app.buttons["Pick up where I left off"]
        XCTAssertTrue(resume.waitForExistence(timeout: 30), "no draft offered after relaunch: \(texts(app))")
        note("after relaunch: \(texts(app))")
        shot("wf-relaunch")
    }

    /// WORKFLOW=2, after WORKFLOW=1 on the same scan: the PDF is shared to the app
    /// again (ios.sh leaves it in the drawer), the draft is picked up and the scan
    /// read, and the three corrections must be back -- and the boxes nobody
    /// reached still marked as the tool's. Then the spreadsheet.
    func testWorkflowResume() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORKFLOW"] == "2" else { return }
        let expect = out.deletingLastPathComponent().appendingPathComponent("workflow-expect.txt")
        let expected: [(card: Int, item: String, section: String, value: Int)] =
            ((try? String(contentsOf: expect, encoding: .utf8)) ?? "").split(separator: "\n").compactMap {
                let p = $0.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
                guard p.count == 4, let c = Int(p[0]), let v = Int(p[3]) else { return nil }
                return (c, p[1], p[2], v)
            }
        XCTAssertEqual(expected.count, 3, "run WORKFLOW=1 first")
        let app = XCUIApplication(bundleIdentifier: "com.mateobesse.surfriderdatacards")
        app.launch()

        // The shared PDF opens a new cleanup; the draft waits on screen 1.
        let cleanups = app.buttons["Cleanups"]
        XCTAssertTrue(cleanups.waitForExistence(timeout: 60), "no event screen: \(texts(app))")
        cleanups.tap()
        let resume = app.buttons["Pick up where I left off"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "no draft offered: \(texts(app))")
        note("draft offered: \(texts(app))")
        resume.tap()
        let read = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Read '")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 30), "the shared scan is not waiting: \(texts(app))")
        read.tap()
        let start = app.buttons["Start checking"]
        XCTAssertTrue(start.waitForExistence(timeout: 1800), "reading did not finish: \(texts(app))")
        note("read: \(texts(app).last ?? "")")
        start.tap()
        note("review after resume: \(texts(app))")
        shot("wf2-review")
        XCTAssertTrue(app.buttons["All cards"].waitForExistence(timeout: 30))
        app.buttons["All cards"].tap()
        XCTAssertTrue(app.buttons["Make the spreadsheet"].waitForExistence(timeout: 30))
        note("cards: \(texts(app).prefix(6))")
        shot("wf2-cards")
        for e in expected {
            guard let row = find(app, tag: "C\(e.card)", item: e.item, section: e.section) else {
                note("CORRECTION LOST C\(e.card) \(e.item): not on the list")
                XCTFail("C\(e.card) \(e.item) not on the list")
                return
            }
            let ok = row.label.hasSuffix(", \(e.value)") || row.label.contains(", \(e.value),")
            note("\(ok ? "kept" : "CORRECTION LOST") C\(e.card) \(e.item) = \(e.value): row says \(row.label)")
            XCTAssertTrue(ok, "C\(e.card) \(e.item) should be \(e.value): \(row.label)")
            scrollToTop(app)
        }
        app.buttons["Make the spreadsheet"].tap()
        let make = app.buttons["Make the spreadsheet"]
        XCTAssertTrue(make.waitForExistence(timeout: 10), "no finish screen")
        note("finish: \(texts(app))")
        shot("wf2-finish")
        make.tap()
        XCTAssertTrue(app.staticTexts["Ready to send"].waitForExistence(timeout: 120), "no spreadsheet: \(texts(app))")
        note("exported: \(texts(app))")
    }

    /// Where the row for this card and item is on screen, scrolling the list until it shows.
    private func find(_ app: XCUIApplication, tag: String, item: String, section: String) -> (label: String, at: CGPoint)? {
        let list = app.scrollViews.firstMatch
        let screen = app.windows.firstMatch.frame
        var lastSeen = ""
        for _ in 0..<300 {
            let visible = flat(app).filter {
                !$0.frame.isEmpty && screen.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY))
            }
            // A row is one button labelled "C4, Cigarette Butts, Common & Priority Items, 4".
            // Item names hold commas of their own, so the label is matched from the front,
            // section included: the six "Other" rows differ only in theirs.
            for b in visible where b.elementType == .button && b.label.hasPrefix("\(tag), \(item), \(section), ") {
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
