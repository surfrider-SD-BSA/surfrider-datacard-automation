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
    var date = ""
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
    let chapter = "Surfrider San Diego · CH54"

    // MARK: Navigation

    @Published var path: [Screen] = []

    // MARK: The event

    @Published var event = EventForm()

    // MARK: The scan

    @Published private(set) var scan: ScanResult?
    @Published private(set) var cells: [FlatCell] = []
    @Published private(set) var readingError: String?

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
        offeredDraft = drafts.load()
    }

    // MARK: - Starting

    func startNewCleanup() {
        event = EventForm()
        clearScan()
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
            cells = result.cards.flatMap { card in
                card.cells.map { FlatCell(key: CellKey(card: card.cardNumber, row: $0.row), column: card.column, cell: $0) }
            }

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

    /// Put the tool's own readings in, where they clear the gate.
    ///
    /// The gate is `PREFILL_GATE` in src/lib/prefill.ts and the engine has
    /// already applied it: a cell arrives with a prefill or without one. Around
    /// one filled box in five is wrong at the current setting. Every one of
    /// them is tagged and sits beside a picture of the handwriting, which is
    /// the only reason it is defensible.
    private func seedPrefills() {
        for flat in cells {
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
    }

    private func clearScan() {
        scan = nil
        cells = []
        values = [:]
        untouched = [:]
        index = 0
        entry = ""
        exportedFile = nil
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
        switch key {
        case "C": entry = ""
        case "<": entry = String(entry.dropLast())
        default: entry = String((entry + key).prefix(4))
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
            flush()
        }
    }

    func flush() {
        guard let scan, !values.isEmpty else { return }
        drafts.save(Draft(scan: scan, event: event, values: values))
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
                text: "\(cardCount) card\(cardCount == 1 ? "" : "s"), \(cells.count) cell\(cells.count == 1 ? "" : "s"), \(checkedCount) filled in."
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
