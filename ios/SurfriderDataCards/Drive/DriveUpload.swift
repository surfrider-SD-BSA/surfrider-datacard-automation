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
//  WHERE IT GOES: A FOLDER THIS APP MADE. Under `drive.file` the app cannot
//  write into a folder it was not handed by Google's Picker -- but it can always
//  write into one it created itself. Saving used to open the Picker in folder
//  mode, and on a phone the Picker does not work: it runs in a docs.google.com
//  frame inside the github.io page, Safari blocks that frame's cookies, and
//  Google answers "Can't access your Google Account ... allowing cookie access"
//  (Eric's phone at South Ponto, 24 Oct 2026). So the spreadsheet goes into a
//  "Surfrider Data Cards" folder in the volunteer's Drive, made on the first
//  save and found again after, with no page in between.
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

    /// The folder name in the volunteer's Drive.
    static let folderName = "Surfrider Data Cards"

    /// The id of this app's folder, made if there is none.
    ///
    /// A search under `drive.file` only sees what this app created, so a
    /// folder of the same name the volunteer made by hand is not found and not
    /// written into; one of ours is. Remembered between saves, and looked up
    /// again if it has since been deleted.
    static func appFolder(accessToken: String) async throws -> String {
        if let known = UserDefaults.standard.string(forKey: folderKey),
           try await exists(known, accessToken: accessToken) {
            return known
        }

        var search = URLComponents(string: "https://www.googleapis.com/drive/v3/files")!
        search.queryItems = [
            .init(name: "q", value: "mimeType = 'application/vnd.google-apps.folder' and name = '\(folderName)' and trashed = false"),
            .init(name: "spaces", value: "drive"),
            .init(name: "fields", value: "files(id)"),
        ]
        struct Listing: Decodable { struct File: Decodable { let id: String }; let files: [File] }
        let listing: Listing = try await json(search.url, accessToken: accessToken)
        if let found = listing.files.first?.id {
            UserDefaults.standard.set(found, forKey: folderKey)
            return found
        }

        var create = URLRequest(url: URL(string: "https://www.googleapis.com/drive/v3/files?fields=id")!)
        create.httpMethod = "POST"
        create.setValue("application/json", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": folderName, "mimeType": "application/vnd.google-apps.folder",
        ])
        struct Created: Decodable { let id: String }
        let made: Created = try await json(create, accessToken: accessToken)
        UserDefaults.standard.set(made.id, forKey: folderKey)
        return made.id
    }

    private static let folderKey = "drive.appFolderId"

    private static func exists(_ id: String, accessToken: String) async throws -> Bool {
        let url = URL(string: "https://www.googleapis.com/drive/v3/files/\(id)?fields=trashed")
        struct State: Decodable { let trashed: Bool? }
        guard let state: State = try? await json(url, accessToken: accessToken) else { return false }
        return state.trashed != true
    }

    private static func json<T: Decodable>(_ url: URL?, accessToken: String) async throws -> T {
        guard let url else { throw DriveError.malformedRequest }
        return try await json(URLRequest(url: url), accessToken: accessToken)
    }

    private static func json<T: Decodable>(_ request: URLRequest, accessToken: String) async throws -> T {
        var request = request
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(T.self, from: data)
        else { throw DriveError.upload(name: folderName, status: (response as? HTTPURLResponse)?.statusCode ?? 0) }
        return decoded
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
