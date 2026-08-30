//
//  The one drawer both halves of this app can reach.
//
//  A share extension is a separate process with a separate container, so a PDF
//  the share sheet hands to the extension is somewhere the app cannot see. An
//  App Group is the only supported way across, and this is the whole of what
//  goes through it: files, in one direction, one at a time.
//
//  NOTHING IS STORED HERE. The extension writes a copy; the app moves it out on
//  its next launch and deletes the original. The drawer is empty between the
//  share and the read, and if the app is never opened the file is the only
//  thing left in it -- which is why `sweep` throws away anything a week old.
//  The promise every screen in this app makes is that a scan stays on the
//  phone and does not accumulate; a shared container that quietly filled up
//  with old cleanups would break the second half of that.
//
//  THE GROUP IDENTIFIER IS NOT WRITTEN HERE. It comes from the Info.plist key
//  `AppGroupIdentifier`, which both targets set to `$(APP_GROUP_ID)` from the
//  build settings, which is `group.$(APP_BUNDLE_ID)`. One string, set once, so
//  that renaming the bundle cannot leave the two halves pointed at different
//  drawers -- a failure that looks exactly like the share doing nothing.
//

import Foundation

enum SharedInbox {

    /// Whatever the build put in the Info.plist. Nil rather than a guess: a
    /// wrong group identifier fails silently at the container call, and a
    /// missing one should be loud.
    static var groupIdentifier: String? {
        guard let id = Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String,
              !id.isEmpty, id != "$(APP_GROUP_ID)"
        else { return nil }
        return id
    }

    /// The drawer, created on first use.
    ///
    /// Nil when the App Group is not provisioned -- which is the ordinary state
    /// of an unsigned simulator build, so every caller has to cope rather than
    /// force-unwrap. See `Failure.unavailable` for what the extension says.
    static var directory: URL? {
        guard let group = groupIdentifier,
              let container = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: group)
        else { return nil }

        let inbox = container.appendingPathComponent("Inbox", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)) != nil
        else { return nil }
        return inbox
    }

    // MARK: - Writing, from the extension

    /// Copy a file the share sheet provided into the drawer.
    ///
    /// The name it is filed under is a UUID, a separator and the name it
    /// arrived with, so that two shares of `scan.pdf` cannot collide and the
    /// app can still put the real name on the button.
    @discardableResult
    static func deposit(_ url: URL, named name: String) throws -> URL {
        guard let inbox = directory else { throw Failure.unavailable }

        let clean = URL(fileURLWithPath: name).lastPathComponent
        let filed = inbox.appendingPathComponent(
            UUID().uuidString + separator + (clean.isEmpty ? "scan.pdf" : clean)
        )
        try FileManager.default.copyItem(at: url, to: filed)
        return filed
    }

    // MARK: - Reading, from the app

    /// What is waiting, oldest first -- share order, which is the order a
    /// person would expect them back in.
    static func waiting() -> [URL] {
        guard let inbox = directory else { return [] }
        let found = (try? FileManager.default.contentsOfDirectory(
            at: inbox,
            includingPropertiesForKeys: [.creationDateKey],
            options: [.skipsHiddenFiles]
        )) ?? []

        return found.sorted { left, right in
            let a = (try? left.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? .distantPast
            let b = (try? right.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? .distantPast
            return a < b
        }
    }

    /// The name the file had before it was stamped, for the button on screen 3.
    static func originalName(of url: URL) -> String {
        let filed = url.lastPathComponent
        guard let range = filed.range(of: separator) else { return filed }
        return String(filed[range.upperBound...])
    }

    static func remove(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    /// Throw away anything the app never came back for. A week is long enough
    /// to cover a cleanup shared on the beach and opened the next weekend, and
    /// short enough that the drawer is not an archive.
    static func sweep(olderThan age: TimeInterval = 7 * 24 * 60 * 60) {
        let cutoff = Date().addingTimeInterval(-age)
        for file in waiting() {
            let created = (try? file.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
            if created < cutoff { remove(file) }
        }
    }

    // MARK: -

    enum Failure: LocalizedError {
        /// The App Group is not there. On a signed build this means the
        /// capability is missing from the App ID; on an unsigned simulator
        /// build it is simply how things are.
        case unavailable
        case notAPDF

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "This build cannot reach Data Cards' shared storage. Open the app and choose the PDF there."
            case .notAPDF:
                return "That is not a PDF. Data Cards reads a scan of the cards, front and back, as one PDF."
            }
        }
    }

    private static let separator = "__"
}
