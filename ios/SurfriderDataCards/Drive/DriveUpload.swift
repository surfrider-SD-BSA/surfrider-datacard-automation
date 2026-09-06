//
//  Putting the finished spreadsheet back where the scans came from.
//
//  The other direction of DriveDownload, and the reason it costs nothing extra:
//  `drive.file` is the scope for files an app CREATES as much as for files a
//  person picks. Uploading asks for no broader consent than opening a scan
//  already did, needs no second API, and the volunteer sees the same one line
//  on the same consent screen. Had this wanted `drive` or `drive.readonly` it
//  would have been a different conversation.
//
//  THE DESTINATION HAS TO BE PICKED, and that is not a UI preference. Under
//  `drive.file` this app cannot name a folder it was not handed: writing into
//  one requires that the folder itself came back from Google's Picker, which is
//  what grants access to it. So saving opens the picker in folder mode. The
//  configured folder from DriveConfig cannot be used as a silent default for
//  the same reason -- the app knows its id, and knowing an id is not access.
//
//  Small files, one request. The spreadsheet is tens of kilobytes -- a few
//  hundred values in the chapter's template -- so this is a single multipart
//  POST with no resumable-session machinery and no progress bar to watch. If
//  the export ever grows to where that matters, this is the thing to change,
//  and `uploadType=resumable` is the thing to change it to.
//

import Foundation
import UniformTypeIdentifiers

enum DriveUpload {

    /// Upload a local file into a Drive folder, returning the new file's id.
    static func file(
        at url: URL,
        toFolder folderId: String,
        accessToken: String
    ) async throws -> String {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw DriveError.cannotRead(name: url.lastPathComponent)
        }

        var components = URLComponents(string: "https://www.googleapis.com/upload/drive/v3/files")!
        components.queryItems = [
            .init(name: "uploadType", value: "multipart"),
            .init(name: "supportsAllDrives", value: "true"),
            // Ask for the id back rather than the whole resource.
            .init(name: "fields", value: "id"),
        ]
        guard let endpoint = components.url else { throw DriveError.malformedRequest }

        let boundary = "datacards-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/related; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body(
            boundary: boundary,
            metadata: metadata(name: url.lastPathComponent, folderId: folderId),
            mimeType: mimeType(for: url),
            data: data
        )

        let (response, http) = try await URLSession.shared.data(for: request)
        guard let status = (http as? HTTPURLResponse)?.statusCode else {
            throw DriveError.malformedRequest
        }
        guard status == 200 else {
            throw DriveError.upload(name: url.lastPathComponent, status: status)
        }

        struct Created: Decodable { let id: String }
        guard let created = try? JSONDecoder().decode(Created.self, from: response) else {
            // A 200 with a body that will not decode means the file is very
            // probably there. Say so rather than implying it failed.
            throw DriveError.uploadUnconfirmed(name: url.lastPathComponent)
        }
        return created.id
    }

    // MARK: -

    /// The JSON half. `parents` is the whole point: without it the file lands
    /// loose in the volunteer's Drive root rather than in the chapter's folder.
    private static func metadata(name: String, folderId: String) -> Data {
        let object: [String: Any] = ["name": name, "parents": [folderId]]
        return (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }

    private static func body(
        boundary: String,
        metadata: Data,
        mimeType: String,
        data: Data
    ) -> Data {
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        append("--\(boundary)\r\n")
        append("Content-Type: application/json; charset=UTF-8\r\n\r\n")
        body.append(metadata)
        append("\r\n--\(boundary)\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        append("\r\n--\(boundary)--\r\n")
        return body
    }

    /// From the extension, because that is what the file has. The export is an
    /// .xlsx; anything else is something a later change introduced, and
    /// `octet-stream` is a better answer for it than a wrong guess.
    private static func mimeType(for url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
    }
}
