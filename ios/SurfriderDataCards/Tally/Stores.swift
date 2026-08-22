//
//  What survives the app being closed.
//
//  Two files, both in Application Support, both JSON, neither leaving the
//  device. The scan itself is never written down: the crops are pictures of
//  volunteer handwriting, and the promise on every screen is that they stay in
//  memory and go when the app does. What is kept is what somebody typed.
//

import Foundation

// MARK: - The draft

/// Typing up a 58-card event is hundreds of numbers read off hundreds of
/// pictures. Losing that to a phone call is a bad failure on any tool and a
/// worse one here, because the person doing the typing is a volunteer doing it
/// for free.
///
/// Three things this deliberately does NOT do, carried over from
/// src/lib/draft.ts:
///
///   It does not restore anything on its own. A draft is offered, with its age
///   and how many values it holds, and the reviewer says yes.
///
///   It does not offer a draft for a different scan. The values are keyed by
///   card number and taxonomy row, which are stable for a given PDF and
///   meaningless across two, so the draft records a fingerprint and is only
///   applied on an exact match.
///
///   It does not leave the device.
struct Draft: Codable {
    var fileName: String
    var fileSize: Int
    var cardCount: Int
    var cellCount: Int
    var savedAt: Date
    var event: EventForm
    var values: [CellKey: Int]

    init(scan: ScanResult, event: EventForm, values: [CellKey: Int]) {
        self.fileName = scan.fileName
        self.fileSize = scan.fileSize
        self.cardCount = scan.cards.count
        self.cellCount = scan.cards.reduce(0) { $0 + $1.cells.count }
        self.savedAt = Date()
        self.event = event
        self.values = values
    }

    /// Is this draft for the scan now in memory?
    func matches(_ scan: ScanResult) -> Bool {
        fileName == scan.fileName
            && fileSize == scan.fileSize
            && cardCount == scan.cards.count
            && cellCount == scan.cards.reduce(0) { $0 + $1.cells.count }
    }

    /// "3 minutes ago", for a line somebody has to make a decision from.
    var age: String {
        let seconds = max(0, Int(Date().timeIntervalSince(savedAt)))
        if seconds < 90 { return "just now" }
        let minutes = Int((Double(seconds) / 60).rounded())
        if minutes < 60 { return "\(minutes) minutes ago" }
        let hours = Int((Double(minutes) / 60).rounded())
        if hours < 24 { return "\(hours) hour\(hours == 1 ? "" : "s") ago" }
        let days = Int((Double(hours) / 24).rounded())
        return "\(days) day\(days == 1 ? "" : "s") ago"
    }
}

/// `CellKey` is a struct, and a dictionary keyed by one encodes as an array
/// unless it is told how to be a string. Being able to read the file matters:
/// it is the only copy of somebody's afternoon.
extension CellKey: CodingKeyRepresentable {
    public var codingKey: any CodingKey { StringKey("\(card):\(row)") }

    public init?<T: CodingKey>(codingKey: T) {
        let parts = codingKey.stringValue.split(separator: ":")
        guard parts.count == 2, let card = Int(parts[0]), let row = Int(parts[1]) else { return nil }
        self.init(card: card, row: row)
    }

    private struct StringKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ value: String) { stringValue = value }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

final class DraftStore {
    private let url = Support.file("draft.json")

    func save(_ draft: Draft) {
        // Losing the draft is bad; taking the app down while somebody is typing
        // is worse. A write that fails is a write that failed.
        guard let data = try? JSONEncoder.iso.encode(draft) else { return }
        try? data.write(to: url, options: .atomic)
    }

    func load() -> Draft? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder.iso.decode(Draft.self, from: data)
    }

    func clear() { try? FileManager.default.removeItem(at: url) }
}

// MARK: - Finished cleanups

/// The "Finished" list on screen 1.
///
/// A line per event that was actually exported: what it was, when, and how many
/// cards. No values and no pictures -- this is a record that the work was done,
/// not a second copy of it.
struct FinishedEvent: Codable, Identifiable, Hashable {
    var id = UUID()
    var beach: String
    /// ISO, as typed on screen 2.
    var date: String
    var cards: Int
    var exportedAt: Date

    /// "21 Feb · 58 cards · sent"
    var meta: String {
        var parts: [String] = []
        if let day = DateFormatter.iso.date(from: date) {
            parts.append(DateFormatter.short.string(from: day))
        } else if !date.isEmpty {
            parts.append(date)
        }
        parts.append("\(cards) card\(cards == 1 ? "" : "s")")
        parts.append("sent")
        return parts.joined(separator: " · ")
    }
}

final class FinishedStore: ObservableObject {
    @Published private(set) var events: [FinishedEvent] = []

    private let url = Support.file("finished.json")

    init() {
        if let data = try? Data(contentsOf: url),
           let saved = try? JSONDecoder.iso.decode([FinishedEvent].self, from: data) {
            events = saved
        }
    }

    func record(beach: String, date: String, cards: Int) {
        let event = FinishedEvent(
            beach: beach.trimmingCharacters(in: .whitespaces),
            date: date,
            cards: cards,
            exportedAt: Date()
        )
        events.insert(event, at: 0)
        // Ten is what fits on the screen without becoming an archive nobody
        // asked this app to keep.
        events = Array(events.prefix(10))
        if let data = try? JSONEncoder.iso.encode(events) {
            try? data.write(to: url, options: .atomic)
        }
    }
}

// MARK: -

private enum Support {
    static func file(_ name: String) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent(name)
    }
}

private extension JSONEncoder {
    static let iso: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

private extension JSONDecoder {
    static let iso: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

extension DateFormatter {
    static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// "21 Feb"
    static let short: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "d MMM"
        return f
    }()
}
