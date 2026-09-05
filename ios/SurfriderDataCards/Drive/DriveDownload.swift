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
        }
    }
}
