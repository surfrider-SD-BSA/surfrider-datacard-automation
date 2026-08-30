//
//  Everything the eight screens read from, and the only place a value lives.
//
//  `values` IS THE TRUTH. Nothing else is allowed to be, and the reason is on
//  the web side: `assertTypedValues` in src/main.ts exists because Chrome
//  restored form state into boxes that had become different items after a
//  refresh, and three cells came back pre-filled against items nobody had typed
//  for. That is the one outcome this tool must never produce.
//
//  The iOS analogue is state restoration and keyboard autofill, and screen 6
//  answers it by construction: the number is typed on a keypad this app draws,
//  into a String this model owns. There is no UITextField in the path, so there
//  is nothing for iOS to restore into and nothing for autofill to reach. The
//  event form on screen 2 does use real text fields -- those are strings a
//  person reads back off the screen before leaving, not four hundred numbers
//  nobody would notice.
//

import Foundation
import SwiftUI

// MARK: -

struct CellKey: Hashable, Codable {
    let card: Int
    let row: Int
}

/// One cell, with the card it came from. The checking screen walks these in
/// order; the card list shows them all.
struct FlatCell: Identifiable, Hashable {
    let key: CellKey
    /// Card 1 is column C. Straight from the engine, never recomputed here.
    let column: String
    let cell: ScanCell

    var id: CellKey { key }
}

struct EventForm: Codable, Equatable {
    /// Today, not the empty string.
    ///
    /// This was `""`, and it cost an afternoon. The date picker's getter falls
    /// back to `Date()` when the string will not parse, so the screen showed
    /// today's date while the model held nothing -- and the setter only fires
    /// when somebody CHANGES the date. Accept the date already on screen, type
    /// a beach, and "Scan the cards" stayed disabled with no way to see why,
    /// because the field it was complaining about looked filled in.
    ///
    /// A control must not display a value the model does not have. Defaulting
    /// here is what makes the two agree from the first frame.
    var date = DateFormatter.iso.string(from: Date())
    var shoreline = ""
    var volunteers = ""
    var pounds = ""
    /// Off-screen defaults, per the handoff: duration is two hours and the club
    /// is the chapter string. Both are editable, neither is asked for.
    var durationHours = "2"
    var dataEntryVolunteer = ""
    var club = "Surfrider San Diego (CH54)"

    /// Only the date and the beach are needed to finish. Everything else is
    /// written on the leader's card and often on no other.
    var isComplete: Bool {
        !date.isEmpty && !shoreline.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

enum Screen: Hashable {
    case event
    case capture
    case reading
    case refused
    case review
    case cards
    case finish
}

// MARK: -

@MainActor
final class TallyModel: ObservableObject {

    let engine: Engine

    /// The cell pictures, kept and fetched ahead of the reviewer. Screen 6 asks
    /// this rather than the engine; see the note on `CropCache`.
    let crops: CropCache

    let chapter = "Surfrider San Diego · CH54"

    // MARK: Navigation

    @Published var path: [Screen] = []

    // MARK: The event

    @Published var event = EventForm()

    // MARK: The scan

    @Published private(set) var scan: ScanResult?

    /// Every cell the tool found something in, review list or not. What gets
    /// exported is seeded from here, because most of it is never shown.
    @Published private(set) var allCells: [FlatCell] = []

    /// The review list: the cells the tool did NOT take as read.
    ///
    /// A cell above `AUTO_ACCEPT` (src/lib/prefill.ts) is not in here and there
    /// is no screen in this app that will show it -- it is filled in, exported
    /// as a machine reading with its confidence, and never put in front of
    /// anyone. Around 60% of a real scan. The threshold, and what it costs, is
    /// documented where it is set.
    @Published private(set) var cells: [FlatCell] = []

    /// How many cells were taken as read and kept off the list.
    var takenAsReadCount: Int { allCells.count - cells.count }

    @Published private(set) var readingError: String?

    /// A PDF another app handed us — AirDrop, Mail, Files, the share sheet.
    ///
    /// Not read on arrival. The event's date and beach come first, and a scan
    /// that started reading the instant it landed would skip the one screen
    /// that gates the export. It is offered on the capture screen instead.
    @Published var pendingPDF: URL?

    /// Pages the pipeline refused, worst first. A page that will not line up is
    /// surfaced rather than cropped from -- a misregistered page yields
    /// ordinary-looking numbers attached to the wrong debris items, and nothing
    /// downstream could catch it.
    var refusedPages: [ScanPage] {
        (scan?.pages ?? []).filter { !$0.trusted }.sorted { $0.bannerOverlap < $1.bannerOverlap }
    }

    // MARK: What has been typed

    @Published private(set) var values: [CellKey: Int] = [:]

    /// The values that are still there as the tool put them.
    ///
    /// Kept apart from `values` because the spreadsheet records, per value,
    /// whether a human entered it. A machine reading a reviewer scrolled past
    /// is not the same evidence as a number somebody read off the picture.
    /// Touching a box takes its cell out of here.
    @Published private(set) var untouched: [CellKey: ScanCell.Prefill] = [:]

    /// Where the reviewer is, and what is on the keypad.
    @Published var index = 0
    @Published var entry = ""

    // MARK: Finishing

    @Published private(set) var exportedFile: URL?
    @Published var exportError: String?

    // MARK: Drafts

    @Published private(set) var offeredDraft: Draft?

    private let drafts = DraftStore()
    let finished = FinishedStore()
    private var saveTask: Task<Void, Never>?

    // MARK: -

    init(engine: Engine) {
        self.engine = engine
        self.crops = CropCache(engine: engine)
        offeredDraft = drafts.load()
    }

    // MARK: - Starting

    /// Another app opened a PDF with us. Start a cleanup and hold the file.
    ///
    /// Returns whether the copy is in hand. Only `takeShared` looks: it deletes
    /// the original afterwards and must not do that for a file it failed to
    /// take.
    @discardableResult
    func openExternal(_ url: URL, named name: String? = nil) -> Bool {
        // Copied out of the inbox immediately: the system deletes what it puts
        // there, on its own schedule, and a scan that vanishes between the tap
        // and the read is a bug nobody could reproduce.
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let copy = dir.appendingPathComponent(name ?? url.lastPathComponent)

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { return false }

        startNewCleanup()
        pendingPDF = copy
        return true
    }

    /// A PDF the share extension left in the App Group drawer.
    ///
    /// Checked every time the app becomes active, because there is no
    /// notification when an extension writes: the share happens in another
    /// process, often while this one is not running at all.
    ///
    /// It goes through `openExternal` and so starts a cleanup, discarding
    /// whatever was on screen. That is the same thing opening a PDF from Files
    /// has always done, and it is safe for the same reason -- the draft was
    /// flushed on the way to the background and is offered back on screen 1.
    /// Only the newest is taken; a cleanup is one PDF, and the rest are cleared
    /// rather than queued, so that nothing is left in a container two processes
    /// can reach.
    func takeShared() {
        let waiting = SharedInbox.waiting()
        guard let newest = waiting.last else { return }

        // The drawer is cleared only once the copy is in hand. Deleting the
        // original after a failed copy would lose the scan and leave nothing to
        // say so; leaving it means the next launch tries again, and the
        // extension's `sweep` is the backstop if it never works.
        guard openExternal(newest, named: SharedInbox.originalName(of: newest)) else { return }
        waiting.forEach(SharedInbox.remove)
    }

    func startNewCleanup() {
        event = EventForm()
        clearScan()
        pendingPDF = nil
        // Whatever was on screen is being replaced, and `flush` has already put
        // it on disk. Re-read the offer so screen 1 actually has it: this was
        // loaded at launch and nowhere else, so a cleanup replaced by an
        // arriving scan left its draft on disk with nothing offering it back
        // until the app was next started -- and, worse, left screen 1 offering
        // whatever draft had been on disk at launch instead. `takeShared` says
        // discarding is safe because the draft comes back; this is the line
        // that makes that true.
        offeredDraft = drafts.load()
        path = [.event]
    }

    /// Resume the offered draft. Only ever from a tap: a draft is offered with
    /// its age and its count, and the person chooses. Nothing is ever put back
    /// unasked.
    func resumeDraft() {
        guard let draft = offeredDraft else { return }
        event = draft.event
        // The values are restored, but the scan they belong to is not in memory
        // -- the crops were never on disk and never will be. So the same PDF is
        // asked for, and the draft is applied once it matches.
        pendingRestore = draft
        path = [.capture]
    }

    func discardDraft() {
        drafts.clear()
        offeredDraft = nil
        startNewCleanup()
    }

    private var pendingRestore: Draft?

    // MARK: - Reading a scan

    func read(pdf url: URL) async {
        readingError = nil
        clearScan()
        path.append(.reading)

        // A picked file lives outside the sandbox until it is copied in.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        do {
            let result = try await engine.process(pdf: url) { _ in }
            scan = result
            allCells = result.cards.flatMap { card in
                card.cells.map { FlatCell(key: CellKey(card: card.cardNumber, row: $0.row), column: card.column, cell: $0) }
            }
            cells = allCells.filter { $0.cell.prefill?.takenAsRead != true }

            // Seed the date and beach from the filename where it follows the
            // chapter's convention. Shown for confirmation, never used
            // silently, and never over something already typed.
            if let seeded = result.seeded {
                if event.date.isEmpty { event.date = seeded.date }
                if event.shoreline.isEmpty { event.shoreline = seeded.shoreline }
            }

            seedPrefills()
            applyPendingRestoreIfItMatches()
        } catch {
            readingError = error.localizedDescription
        }
    }

    /// Put the tool's own readings in, wherever it has one.
    ///
    /// The gate is `PREFILL_GATE` in src/lib/prefill.ts, now 0: a cell arrives
    /// with a prefill if either reader offered anything at all. Around one
    /// filled box in five is wrong.
    ///
    /// Over `allCells` rather than `cells`, and that is the whole difference
    /// auto-accept makes here: the readings the tool is surest of are exactly
    /// the ones with no screen behind them, so seeding from the review list
    /// would drop the majority of the values out of the export. Those cells are
    /// tagged and beside a picture of the handwriting for anyone who reaches
    /// them; the auto-accepted ones are neither, and go out on the tool's word.
    private func seedPrefills() {
        for flat in allCells {
            guard let prefill = flat.cell.prefill else { continue }
            values[flat.key] = prefill.value
            untouched[flat.key] = prefill
        }
    }

    /// A draft is only ever applied to the scan it was taken from.
    ///
    /// The values are keyed by card number and taxonomy row, which are stable
    /// for a given PDF and meaningless across two. So the draft carries a
    /// fingerprint of the file and of what came out of it, and is dropped on
    /// anything else. Same rule as `draftMatches` in src/lib/draft.ts.
    private func applyPendingRestoreIfItMatches() {
        guard let draft = pendingRestore, let scan else { return }
        pendingRestore = nil
        guard draft.matches(scan) else { return }

        values = draft.values
        // A restored draft is a person's work. Nothing in it is claimed as a
        // machine reading, even where the number happens to match what the tool
        // would have counted -- the reviewer saw these boxes and kept them.
        untouched = [:]

        // Except the ones they were never shown, which no draft can turn into
        // a person's work: they were not on the list being worked through. Only
        // where the saved value still matches what the tool read, since a draft
        // taken before this setting existed may hold a number somebody really
        // did type into a box that is no longer on the list.
        for flat in allCells {
            guard let prefill = flat.cell.prefill, prefill.takenAsRead else { continue }
            guard values[flat.key] == prefill.value else { continue }
            untouched[flat.key] = prefill
        }
    }

    private func clearScan() {
        scan = nil
        allCells = []
        cells = []
        values = [:]
        untouched = [:]
        index = 0
        entry = ""
        exportedFile = nil
        crops.clear()
        Task { await engine.reset() }
    }

    // MARK: - Checking

    var current: FlatCell? { cells.indices.contains(index) ? cells[index] : nil }

    var checkedCount: Int { values.count }

    /// Load the keypad with whatever this cell already holds, so that moving
    /// back to a cell shows what is in it rather than an empty box.
    func syncEntryToCurrentCell() {
        guard let current else { entry = ""; return }
        entry = values[current.key].map(String.init) ?? ""
    }

    func press(_ key: String) {
        guard let current else { return }

        // A box the tool filled is REPLACED by the first digit, not appended to.
        //
        // The desktop tool puts its readings in a text field, where typing over
        // one is what a text field does. Here the number is on a keypad, and
        // appending to a pre-filled 14 gives 143 -- so correcting the tool's
        // guess would mean spotting that you have to clear it first, on the one
        // screen where the whole job is correcting the tool's guesses.
        let replacingMachineReading = untouched[current.key] != nil

        switch key {
        case "C": entry = ""
        case "<": entry = replacingMachineReading ? "" : String(entry.dropLast())
        default: entry = String(((replacingMachineReading ? "" : entry) + key).prefix(4))
        }

        // The moment a person touches the keypad this box is theirs, however it
        // started out, and the export stops calling it a machine reading.
        untouched.removeValue(forKey: current.key)
    }

    /// Write the value and move on. `nil` records a true zero -- "Nothing there".
    func commit(_ value: Int?) {
        guard let current else { return }
        if let value {
            values[current.key] = value
            untouched.removeValue(forKey: current.key)
        } else if let typed = Int(entry) {
            values[current.key] = typed
        }
        scheduleSave()

        entry = ""
        if index + 1 >= cells.count {
            path.append(.cards)
        } else {
            index += 1
            syncEntryToCurrentCell()
        }
    }

    func jump(to key: CellKey) {
        guard let at = cells.firstIndex(where: { $0.key == key }) else { return }
        index = at
        syncEntryToCurrentCell()
        path.append(.review)
    }

    // MARK: - Persistence

    /// Write the draft at most a few times a second.
    ///
    /// Debounced because this runs on every committed value and serializing the
    /// lot each time would be felt. 400ms, matching `scheduleSave` on the web
    /// side; `flush` closes the gap when the app goes to the background.
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            guard let draft = currentDraft() else { return }
            // Off the main thread. A few hundred values through JSONEncoder and
            // out to disk is small, but on this path it lands between two
            // keystrokes on the one screen whose whole job is keystrokes, and
            // there is nothing waiting on it. `flush` stays synchronous, for
            // the opposite reason.
            let store = drafts
            await Task.detached(priority: .utility) { store.save(draft) }.value
        }
    }

    /// Write the draft now, on this thread.
    ///
    /// The one caller is the app going to the background, which is exactly the
    /// moment a write must not be left in the air.
    func flush() {
        guard let draft = currentDraft() else { return }
        drafts.save(draft)
    }

    private func currentDraft() -> Draft? {
        guard let scan, !values.isEmpty else { return nil }
        return Draft(scan: scan, event: event, values: values)
    }

    // MARK: - Export

    /// The gate: warnings, not walls. You can send it anyway -- you are the one
    /// who saw the paper.
    struct GateItem: Identifiable {
        enum Tone { case pass, warning, privacyNote }
        let id = UUID()
        let tone: Tone
        let text: String

        var icon: String {
            switch tone {
            case .pass: return Nocturne.Icon.pass
            case .warning: return Nocturne.Icon.warning
            case .privacyNote: return Nocturne.Icon.privacy
            }
        }

        var color: Color {
            switch tone {
            case .pass, .privacyNote: return Nocturne.accent
            case .warning: return Nocturne.accent400
            }
        }
    }

    /// Mirrors `checkExportGate` in src/lib/schema.ts, in the volunteer's words.
    var gateItems: [GateItem] {
        var items: [GateItem] = []
        let cardCount = scan?.cards.count ?? 0

        if let stated = Int(event.volunteers), stated != cardCount {
            items.append(.init(
                tone: .warning,
                text: "The leader's card says \(stated) volunteers, but \(cardCount) card\(cardCount == 1 ? " was" : "s were") scanned. Worth a look — it is usually a card that never made it into the pile."
            ))
        } else {
            items.append(.init(
                tone: .pass,
                text: "\(cardCount) card\(cardCount == 1 ? "" : "s"), \(allCells.count) cell\(allCells.count == 1 ? "" : "s"), \(checkedCount) filled in"
                    + (takenAsReadCount > 0 ? " — \(takenAsReadCount) read confidently and never shown." : ".")
            ))
        }

        if let pounds = Double(event.pounds), pounds > 0 {
            items.append(.init(tone: .pass, text: "\(event.pounds) lb of trash recorded."))
        } else {
            items.append(.init(tone: .warning, text: "Pounds of trash is blank. The sheet still works without it."))
        }

        for page in refusedPages {
            items.append(.init(
                tone: .warning,
                text: "Page \(page.pageNumber) never lined up and was left out. The \(page.side) rows of that card will be empty."
            ))
        }

        // The count the reviewer is entitled to before they send it: how much
        // of this the tool typed rather than they did.
        if !untouched.isEmpty {
            items.append(.init(
                tone: .warning,
                text: "\(untouched.count) value\(untouched.count == 1 ? " was" : "s were") filled in by the tool and not checked. They go to the spreadsheet marked as machine-read."
            ))
        }

        items.append(.init(tone: .privacyNote, text: "The scan stays on this phone. Only the spreadsheet leaves."))
        return items
    }

    var exportName: String {
        let slug = event.shoreline
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: " ", with: "-")
        return "\(event.date)_\(slug.isEmpty ? "Cleanup" : slug).xlsx"
    }

    func makeSpreadsheet() async {
        exportError = nil
        var byCard: [Int: [[Int]]] = [:]
        for (key, value) in values { byCard[key.card, default: []].append([key.row, value]) }

        let input: [String: Any] = [
            "event": [
                "date": event.date,
                "shoreline": event.shoreline.trimmingCharacters(in: .whitespaces),
                "volunteers": Int(event.volunteers) as Any? ?? NSNull(),
                "pounds": Double(event.pounds) as Any? ?? NSNull(),
                "durationHours": Double(event.durationHours) as Any? ?? NSNull(),
                "dataEntryVolunteer": event.dataEntryVolunteer.isEmpty ? NSNull() : event.dataEntryVolunteer,
                "club": event.club.isEmpty ? NSNull() : event.club,
            ] as [String: Any],
            "values": byCard.map { [$0.key, $0.value.sorted { $0[0] < $1[0] }] as [Any] },
            "prefilled": untouched.keys.map { [$0.card, $0.row] },
            "confidences": untouched.map { [$0.key.card, $0.key.row, $0.value.confidence] as [Any] },
        ]

        do {
            let result = try await engine.export(input)
            guard let bytes = result.bytes else { throw EngineError.failed("the workbook came back empty") }

            // A fresh directory each time: the exporter suggests the same
            // filename for the same event, and overwriting would fail rather
            // than replace.
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(result.filename)
            try bytes.write(to: file)

            exportedFile = file
            finished.record(
                beach: event.shoreline,
                date: event.date,
                cards: scan?.cards.count ?? 0
            )
            drafts.clear()
            offeredDraft = nil
        } catch {
            exportError = error.localizedDescription
        }
    }

    func backToCleanups() {
        clearScan()
        event = EventForm()
        path = []
        offeredDraft = drafts.load()
    }
}
