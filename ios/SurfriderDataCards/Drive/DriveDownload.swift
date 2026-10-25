//
//  Getting the bytes of a chosen scan onto the phone.
//
//  The result is a file URL in the app's temporary directory, because that is
//  what `TallyModel.read(pdf:)` takes and what the document picker hands it.
//  From that point a scan that came from Drive is indistinguishable from one
//  that was AirDropped, which is the property worth having: there is one
//  reading path and it is the one measured on 1,606 pages.
//
//  It streams rather than waiting for the whole body, so a 300-page scan over a
//  beach connection shows a bar that moves. That matters more here than in the
//  web tool -- a phone on cellular is the slow case, not the exception.
//

import Foundation

enum DriveDownload {

    /// Download a file by ID, reporting progress from 0 to 1.
    ///
    /// `onProgress` is called from a background task; the caller hops to the
    /// main actor. Progress needs a total, and Drive does not always send
    /// `Content-Length` for a media download, so the size the picker reported
    /// is passed in and used when the header is missing. With neither, the
    /// download still runs and simply reports nothing until it finishes -- a
    /// bar that does not move is better than refusing to fetch the file.
    static func file(
        id: String,
        name: String,
        expectedSize: Int64?,
        accessToken: String,
        onProgress: @Sendable (Double) -> Void
    ) async throws -> URL {
        var components = URLComponents(
            string: "https://www.googleapis.com/drive/v3/files/\(id)"
        )!
        components.queryItems = [
            .init(name: "alt", value: "media"),
            // Harmless on a personal My Drive, and required if the chapter
            // keeps its scans on a shared drive.
            .init(name: "supportsAllDrives", value: "true"),
        ]
        guard let url = components.url else { throw DriveError.malformedRequest }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return try await save(request, name: name, expectedSize: expectedSize, onProgress: onProgress)
    }

    /// Stream `request`'s body into a temporary file named `name`.
    static func save(
        _ request: URLRequest,
        name: String,
        expectedSize: Int64?,
        onProgress: @Sendable (Double) -> Void
    ) async throws -> URL {
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw DriveError.malformedRequest }
        guard http.statusCode == 200 else {
            throw DriveError.download(name: name, status: http.statusCode)
        }

        let headerSize = http.expectedContentLength > 0 ? http.expectedContentLength : nil
        let total = headerSize ?? expectedSize ?? 0

        // Written under the name it has in Drive: the filename is on the button
        // on screen 3, and the web tool seeds the event's date from it.
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(safeName(name))

        FileManager.default.createFile(atPath: destination.path, contents: nil)
        guard let handle = try? FileHandle(forWritingTo: destination) else {
            throw DriveError.cannotWrite
        }
        defer { try? handle.close() }

        // Buffered rather than a write per byte, which is what `bytes` gives.
        var buffer = Data()
        buffer.reserveCapacity(chunkSize)
        var received: Int64 = 0
        var lastReported = 0.0

        for try await byte in bytes {
            buffer.append(byte)
            if buffer.count >= chunkSize {
                try handle.write(contentsOf: buffer)
                received += Int64(buffer.count)
                buffer.removeAll(keepingCapacity: true)

                // Only on a visible change. A progress callback per chunk on a
                // 300MB file is thousands of view updates for a bar 300 points
                // wide, and the reading screen has better things to do.
                if total > 0 {
                    let fraction = min(Double(received) / Double(total), 1)
                    if fraction - lastReported >= 0.01 {
                        lastReported = fraction
                        onProgress(fraction)
                    }
                }
            }
        }
        if !buffer.isEmpty {
            try handle.write(contentsOf: buffer)
            received += Int64(buffer.count)
        }
        onProgress(1)

        return destination
    }

    private static let chunkSize = 64 * 1024

    /// Drive names are arbitrary text and this becomes a path component.
    private static func safeName(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return "scan.pdf" }
        return cleaned.lowercased().hasSuffix(".pdf") ? cleaned : cleaned + ".pdf"
    }
}

// MARK: -

enum DriveError: LocalizedError {
    case cancelled
    case cannotPresent
    case cannotWrite
    case malformedRequest
    case noCode
    case refused(String)
    case stateMismatch
    case tokenExchangeFailed(String?)
    case download(name: String, status: Int)
    case cannotRead(name: String)
    case upload(name: String, status: Int)
    case uploadUnconfirmed(name: String)
    case notPublic(status: Int)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            // Closing the consent screen or the picker is an ordinary thing to
            // do. Callers drop this rather than showing it.
            return nil
        case .cannotPresent:
            return "The Google sign-in screen could not be opened."
        case .cannotWrite:
            return "There was no room on the phone for that scan."
        case .malformedRequest:
            return "That request to Drive could not be built. This is a bug."
        case .noCode:
            return "Google did not send anything back to sign in with."
        case .refused(let reason):
            return "Google refused the sign-in: \(reason)."
        case .stateMismatch:
            // Either a genuine attack or, far more likely, a stale redirect
            // arriving after a retry. Refused either way.
            return "That sign-in did not match the one this app started. Try again."
        case .tokenExchangeFailed(let detail):
            return detail.map { "Google would not complete the sign-in: \($0)." }
                ?? "Google would not complete the sign-in."
        case .download(let name, let status):
            // 403 and 404 here are nearly always sharing, not a bug, and the
            // message should say what to do rather than quote a status code.
            // Same wording as the web tool's.
            let detail = (status == 403 || status == 404)
                ? "Drive would not hand over that file. It may not be shared with this Google account."
                : "Drive returned \(status)."
            return "Could not download “\(name)”. \(detail)"
        case .cannotRead(let name):
            return "“\(name)” could not be read off this phone."
        case .upload(let name, let status):
            // 403 on an upload is the folder, not the file: `drive.file` lets
            // this app write into a folder somebody picked and nowhere else, so
            // the honest reading of a refusal is that the destination is not
            // one they can add to.
            let detail = (status == 403 || status == 404)
                ? "Drive would not add it to that folder. Check you can add files to it."
                : "Drive returned \(status)."
            return "Could not save “\(name)” to Drive. \(detail)"
        case .uploadUnconfirmed(let name):
            return "“\(name)” was sent to Drive, but Drive did not confirm it. Check the folder before sending it again."
        case .notPublic:
            return "That link is not open to anyone. In Drive, set sharing to “Anyone with the link” and try again."
        }
    }
}

// MARK: - Shared by link

/// Scans shared "anyone with the link can view", opened with no Google account.
///
/// The picker needs a sign-in because it can reach a volunteer's private
/// Drive. A chapter's scans are shared publicly, and for those that was a
/// sign-in (and a picker page that would not load on a phone) standing
/// between a volunteer and a file anybody on the internet can open. So a link
/// is pasted instead: a file link is downloaded as it is, a folder link is
/// listed and a PDF chosen from it.
enum DrivePublic {

    enum Link: Equatable {
        case file(String)
        case folder(String)
    }

    /// The file or folder a Drive link points at, or nil if it is not one.
    ///
    /// The shapes Drive hands out: `/file/d/ID/view`, `/open?id=ID`,
    /// `/uc?id=ID`, `/drive/folders/ID`, `/drive/u/0/folders/ID`.
    static func parse(_ text: String) -> Link? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let host = url.host,
              host.hasSuffix("google.com") else { return nil }
        let parts = url.pathComponents
        if let i = parts.firstIndex(of: "folders"), i + 1 < parts.count { return .folder(parts[i + 1]) }
        if let i = parts.firstIndex(of: "d"), i + 1 < parts.count { return .file(parts[i + 1]) }
        if let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "id" })?.value, !id.isEmpty {
            return .file(id)
        }
        return nil
    }

    struct Listed: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let size: String?
        let modifiedTime: String?
        var mimeType: String?

        /// The chapter keeps scans in folders of folders ("Scanned Data Cards"
        /// / "Not entered"), so a folder is listed to be opened, not hidden.
        var isFolder: Bool { mimeType == "application/vnd.google-apps.folder" }
    }

    /// The PDFs and folders in a public folder, folders first.
    ///
    /// From Drive's own embeddable folder view first, which any "anyone with
    /// the link" folder has and which needs no key: this chapter's key is only
    /// allowed the Picker API, and Drive refuses it a file listing (tried 25
    /// Oct 2026: "Requests to this API drive method ... List are blocked").
    /// The API is the fallback, for a build whose key is allowed it.
    static func list(folder id: String, config: DriveConfig?) async throws -> [Listed] {
        if let listed = try? await embeddedList(folder: id), !listed.isEmpty { return listed }
        guard let config else { throw DriveError.notPublic(status: 0) }
        return try await apiList(folder: id, config: config)
    }

    /// Parsed out of `drive.google.com/embeddedfolderview`: each entry is
    /// `id="entry-<file id>"`, then a link (`/drive/folders/` for a folder),
    /// then a `flip-entry-title` with its name.
    static func embeddedList(folder id: String) async throws -> [Listed] {
        var components = URLComponents(string: "https://drive.google.com/embeddedfolderview")!
        components.queryItems = [.init(name: "id", value: id)]
        guard let url = components.url else { throw DriveError.malformedRequest }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw DriveError.notPublic(status: 0) }
        return parseEmbedded(String(decoding: data, as: UTF8.self))
    }

    static func parseEmbedded(_ html: String) -> [Listed] {
        let pattern = #"id="entry-([A-Za-z0-9_-]+)"[\s\S]*?href="([^"]*)"[\s\S]*?flip-entry-title">([^<]+)<"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(html.startIndex..., in: html)
        let listed: [Listed] = regex.matches(in: html, range: range).compactMap { m in
            guard let idRange = Range(m.range(at: 1), in: html),
                  let hrefRange = Range(m.range(at: 2), in: html),
                  let nameRange = Range(m.range(at: 3), in: html) else { return nil }
            let name = String(html[nameRange])
                .replacingOccurrences(of: "&amp;", with: "&")
                .replacingOccurrences(of: "&#39;", with: "'")
                .replacingOccurrences(of: "&quot;", with: "\"")
            let folder = html[hrefRange].contains("/folders/")
            guard folder || name.lowercased().hasSuffix(".pdf") else { return nil }
            return Listed(
                id: String(html[idRange]), name: name, size: nil, modifiedTime: nil,
                mimeType: folder ? "application/vnd.google-apps.folder" : "application/pdf"
            )
        }
        return listed.filter(\.isFolder) + listed.filter { !$0.isFolder }
    }

    private static func apiList(folder id: String, config: DriveConfig) async throws -> [Listed] {
        var components = URLComponents(string: "https://www.googleapis.com/drive/v3/files")!
        components.queryItems = [
            .init(name: "q", value: "'\(id)' in parents and (mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.folder') and trashed = false"),
            .init(name: "orderBy", value: "folder,modifiedTime desc"),
            .init(name: "fields", value: "files(id,name,size,modifiedTime,mimeType)"),
            .init(name: "pageSize", value: "100"),
            .init(name: "supportsAllDrives", value: "true"),
            .init(name: "includeItemsFromAllDrives", value: "true"),
            .init(name: "key", value: config.apiKey),
        ]
        guard let url = components.url else { throw DriveError.malformedRequest }
        var request = URLRequest(url: url)
        request.setValue(referer(config), forHTTPHeaderField: "Referer")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw DriveError.notPublic(status: status) }
        struct Page: Decodable { let files: [Listed] }
        return try JSONDecoder().decode(Page.self, from: data).files
    }

    /// Download a public file. No key and no account: the same address a
    /// browser uses for "Download", with the large-file warning skipped.
    static func download(
        id: String,
        name: String,
        expectedSize: Int64?,
        onProgress: @Sendable (Double) -> Void
    ) async throws -> URL {
        var components = URLComponents(string: "https://drive.usercontent.google.com/download")!
        components.queryItems = [
            .init(name: "id", value: id),
            .init(name: "export", value: "download"),
            .init(name: "confirm", value: "t"),
        ]
        guard let url = components.url else { throw DriveError.malformedRequest }
        let file = try await DriveDownload.save(
            URLRequest(url: url), name: name, expectedSize: expectedSize, onProgress: onProgress
        )
        // A file that is not shared comes back as Google's sign-in page, with a
        // 200. A PDF starts "%PDF"; anything else is that page, not a scan.
        let head = (try? FileHandle(forReadingFrom: file).read(upToCount: 5)) ?? Data()
        guard String(decoding: head, as: UTF8.self).hasPrefix("%PDF") else {
            try? FileManager.default.removeItem(at: file)
            throw DriveError.notPublic(status: 200)
        }
        return file
    }

    /// The picker page's own address: the key's referrer allowlist takes the
    /// full page, not the bare origin (tried 25 Oct 2026).
    private static func referer(_ config: DriveConfig) -> String {
        var c = URLComponents(url: config.pickerURL, resolvingAgainstBaseURL: false)
        c?.query = nil; c?.fragment = nil
        return c?.url?.absoluteString ?? config.pickerURL.absoluteString
    }
}

