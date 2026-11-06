//
//  The pages of a scan, on disk from the moment each is taken.
//
//  A scan has no page limit, so pages cannot wait in memory; and a pile can be
//  half an hour's work, so an app crash or a phone call must not lose it. The
//  pages stay here until they have become a PDF, and the scanner picks them up
//  again next time it opens. On this phone only: left out of backups.
//

import Foundation
import UIKit

final class ScanPageStore {
    /// Where the app keeps its one scan in progress.
    static let shared = ScanPageStore(root: FileManager.default
        .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("CardScanInProgress", isDirectory: true))

    private let root: URL
    private let lock = NSLock()

    init(root: URL) { self.root = root }

    private func files() -> [URL] {
        let found = (try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil
        )) ?? []
        return found
            .filter { $0.pathExtension == "jpg" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    var count: Int {
        lock.lock(); defer { lock.unlock() }
        return files().count
    }

    /// Adds a page after the last one and says how many there now are.
    /// Named from the last page rather than the count, so a page taken after
    /// an undo can never sort ahead of one already there.
    @discardableResult
    func append(_ jpeg: Data) throws -> Int {
        lock.lock(); defer { lock.unlock() }
        var directory = root
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)

        let existing = files()
        let last = existing.last.flatMap { Int($0.deletingPathExtension().lastPathComponent) } ?? 0
        let name = String(format: "%07d.jpg", last + 1)
        try jpeg.write(to: root.appendingPathComponent(name), options: .atomic)
        return existing.count + 1
    }

    /// Throws away the last page and says how many are left.
    @discardableResult
    func removeLast() -> Int {
        lock.lock(); defer { lock.unlock() }
        var existing = files()
        guard let last = existing.popLast() else { return 0 }
        try? FileManager.default.removeItem(at: last)
        return existing.count
    }

    /// Page `index`, counted from 0.
    func image(at index: Int) -> UIImage? {
        lock.lock(); defer { lock.unlock() }
        let existing = files()
        guard existing.indices.contains(index) else { return nil }
        return UIImage(contentsOfFile: existing[index].path)
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: root)
    }

    /// The pages through the same binding as Apple's camera's: 8.5 inches
    /// across and 200 DPI. The caller clears the store once it has the file,
    /// so a failure here loses nothing.
    func pdf() async throws -> URL {
        let pages = count
        return try await CapturedPages.pdf(pageCount: pages) { index in
            self.image(at: index) ?? UIImage()
        }
    }
}
