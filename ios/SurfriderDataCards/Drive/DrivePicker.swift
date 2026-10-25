//
//  Google's picker, in a browser session, and the flow around it.
//
//  The web view is here for one reason, stated at the top of docs/ios-picker.html
//  and worth repeating where somebody will actually be reading: the `drive.file`
//  scope can only be exercised through Google's Picker, the Picker is a
//  JavaScript library, and it will only run on an origin registered with
//  Google. So the picking happens on a published page and everything else --
//  the sign-in, the download, the reading -- is native.
//
//  WHAT GOES IN AND WHAT COMES OUT. A token in, through the URL fragment so it
//  reaches no server; a file id, name and size out, through one
//  `datacards://picker` URL. The page is given no other way to talk to the
//  app: anything that does not decode is dropped, and the page has no access
//  to the model, the scan or the values.
//

import AuthenticationServices
import SwiftUI

// MARK: - The flow

/// Sign in if needed, pick, download. Owned by the capture screen.
@MainActor
final class DriveFlow: ObservableObject {

    enum Stage: Equatable {
        case idle
        /// Waiting on Google's consent screen.
        case authorizing
        /// The picker is up, choosing a scan to read.
        case picking(URL)
        case downloading(fraction: Double, name: String)
        case uploading(name: String)
        /// The spreadsheet is in Drive. Held rather than cleared so the screen
        /// can say so -- a save that leaves no trace looks like one that did
        /// not happen.
        case saved(name: String)
    }

    /// One instance for the app.
    ///
    /// The picker's answer comes back as a `datacards://picker?…` URL, which
    /// lands on `RootView.onOpenURL` rather than on whichever screen opened the
    /// picker. Two `@StateObject`s -- one per screen -- had no way to receive
    /// that, so there is one flow and both screens observe it.
    static let shared = DriveFlow()

    @Published private(set) var stage: Stage = .idle
    @Published var problem: String?

    let auth = DriveAuth()

    /// Nil when this build was made without Google settings, which is the
    /// default. Everything below is a no-op in that case and the capture screen
    /// draws no button, so a build that was never configured has no path into
    /// any of this and makes no network call.
    private let config: DriveConfig?

    init(config: DriveConfig? = DriveConfig.current) {
        self.config = config
    }

    /// Whether to draw the button at all.
    var isAvailable: Bool { config != nil }

    /// `.saved` is a resting state, not work in progress: it is held so the
    /// finish screen can say the spreadsheet is in Drive, and a button left
    /// disabled by it could never be pressed again.
    var isBusy: Bool {
        switch stage {
        case .idle, .saved: return false
        default: return true
        }
    }

    /// Step one: get a token, then put the picker up.
    ///
    /// The consent screen is skipped when a token from earlier in this run of
    /// the app is still good, which is what makes the second scan of an evening
    /// one tap instead of a sign-in.
    func begin(model: TallyModel) async {
        guard let config else { return }
        problem = nil
        stage = .authorizing
        do {
            let token = try await auth.accessToken(for: config)
            let url = pickerURL(token: token, config: config)
            stage = .picking(url)
            // In the sign-in's own browser session, not a Safari sheet: see
            // `DriveAuth.browse`. The answer is the same `datacards://picker`
            // URL as ever, handed straight to the handler RootView also uses.
            let answer = try await auth.browse(url, callbackScheme: "datacards")
            handleCallback(answer, model: model)
        } catch {
            stage = .idle
            report(error)
        }
    }

    /// Step two: the page said a file was chosen.
    func download(_ file: DriveMessage.Picked, into model: TallyModel) async {
        guard let config else { return }
        stage = .downloading(fraction: 0, name: file.name)
        do {
            let token = try await auth.accessToken(for: config)
            let url = try await DriveDownload.file(
                id: file.id,
                name: file.name,
                expectedSize: file.size > 0 ? file.size : nil,
                accessToken: token
            ) { [weak self] fraction in
                Task { @MainActor in
                    guard let self, case .downloading = self.stage else { return }
                    self.stage = .downloading(fraction: fraction, name: file.name)
                }
            }
            stage = .idle
            // Straight into the same call the document picker makes. From here
            // nothing downstream can tell where the file came from.
            await model.read(pdf: url)
        } catch {
            stage = .idle
            report(error)
        }
    }

    /// A `datacards://picker?…` URL, handed over by RootView.
    ///
    /// Only a scan is ever picked now; saving goes to the app's own folder.
    func handleCallback(_ url: URL, model: TallyModel) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        switch value("type") {
        case "cancelled":
            cancel()
        case "error":
            let message = value("message") ?? "The picker could not be opened."
            cancel()
            problem = message
        case "picked":
            guard let id = value("id"), !id.isEmpty else { cancel(); return }
            let name = value("name") ?? "scan.pdf"
            let size = Int64(value("size") ?? "") ?? 0

            switch stage {
            case .picking:
                cancel()
                Task { await download(DriveMessage.Picked(id: id, name: name, size: size), into: model) }
            default:
                // A stale redirect arriving after the sheet was dismissed.
                cancel()
            }
        default:
            cancel()
        }
    }

    func cancel() {
        stage = .idle
    }

    // MARK: - The other direction

    /// Saving: a token, then straight into this app's own Drive folder.
    ///
    /// No picker. It cannot run on a phone (see the note at the top of
    /// DriveUpload), and under `drive.file` a folder the app made needs none.
    func beginSave(_ file: URL) async {
        guard let config else { return }
        problem = nil
        stage = .authorizing
        do {
            let token = try await auth.accessToken(for: config)
            stage = .uploading(name: file.lastPathComponent)
            let folder = try await DriveUpload.appFolder(accessToken: token)
            await save(file, toFolder: folder)
        } catch {
            stage = .idle
            report(error)
        }
    }

    /// Step two: put the spreadsheet in the folder they chose.
    func save(_ file: URL, toFolder folderId: String) async {
        guard let config else { return }
        stage = .uploading(name: file.lastPathComponent)
        do {
            let token = try await auth.accessToken(for: config)
            _ = try await DriveUpload.file(at: file, toFolder: folderId, accessToken: token)
            stage = .saved(name: file.lastPathComponent)
        } catch {
            stage = .idle
            report(error)
        }
    }

    func signOut() {
        auth.signOut()
        stage = .idle
    }

    /// Backing out of the consent screen or the picker is an ordinary thing to
    /// do, and `DriveError.cancelled` describes itself as nothing so that it
    /// lands here rather than in front of somebody as a failure.
    private func report(_ error: Error) {
        guard let message = (error as? LocalizedError)?.errorDescription
                ?? (error as NSError).localizedDescription.nonEmpty
        else { return }
        if case DriveError.cancelled = error { return }
        problem = message
    }

    /// The token travels in the fragment, which is never sent to a server.
    private func pickerURL(token: String, config: DriveConfig, mode: String? = nil) -> URL {
        var items = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "apiKey", value: config.apiKey),
        ]
        if let mode {
            items.append(.init(name: "mode", value: mode))
        }
        if let folderId = config.folderId {
            items.append(.init(name: "folderId", value: folderId))
        }
        if let appId = config.appId {
            items.append(.init(name: "appId", value: appId))
        }
        if config.enableSharedDrives {
            items.append(.init(name: "sharedDrives", value: "true"))
        }

        var fragment = URLComponents()
        fragment.queryItems = items

        var url = URLComponents(url: config.pickerURL, resolvingAgainstBaseURL: false)
        url?.fragment = fragment.percentEncodedQuery
        return url?.url ?? config.pickerURL
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

// MARK: - What the page is allowed to say

enum DriveMessage {
    struct Picked {
        let id: String
        let name: String
        let size: Int64
    }

    case picked(Picked)
    case cancelled
    case failed(String)

    /// Decode a message from the page, or nothing.
    ///
    /// Deliberately strict. This is the one place content from a web page
    /// becomes an instruction to the app, so it is a fixed vocabulary of three
    /// words and anything else -- including a `picked` with no id -- is
    /// dropped rather than interpreted.
    init?(body: Any) {
        guard let dict = body as? [String: Any],
              let type = dict["type"] as? String else { return nil }

        switch type {
        case "picked":
            guard let id = dict["id"] as? String, !id.isEmpty else { return nil }
            let name = (dict["name"] as? String)?.nonEmpty ?? "scan.pdf"
            let size = (dict["size"] as? NSNumber)?.int64Value ?? 0
            self = .picked(Picked(id: id, name: name, size: size))
        case "cancelled":
            self = .cancelled
        case "error":
            self = .failed((dict["message"] as? String)?.nonEmpty ?? "The picker could not be opened.")
        default:
            return nil
        }
    }
}

// MARK: - Opening a shared link

/// "Choose from Google Drive", with no Google account: the chapter's scans
/// folder, shared "anyone with the link", browsed folder by folder, or a
/// pasted link to a scan or a folder. See `DrivePublic`.
///
/// This replaced Google's Picker on the phone. The Picker is a docs.google.com
/// frame inside a github.io page, Safari blocks its cookies, and on Eric's
/// phone it only ever said "Can't access your Google Account" (24 Oct 2026).
struct DriveLinkSheet: View {
    /// Called with the downloaded PDF.
    let onOpened: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    /// The folder open last time, so the next cleanup starts where this one
    /// left off -- usually "Not entered".
    @AppStorage("drive.publicFolderID") private var savedFolder = ""
    @AppStorage("drive.publicFolderName") private var savedFolderName = ""
    @State private var link = ""
    /// The folders opened, root first; the last is the one listed.
    @State private var trail: [(id: String, name: String)] = []
    @State private var files: [DrivePublic.Listed] = []
    @State private var busy: String?
    @State private var problem: String?

    var body: some View {
        ScreenBody(ground: Nocturne.captureGround, topPadding: 28) {
            VStack(alignment: .leading, spacing: 12) {
                Kicker(text: "Google Drive", icon: Nocturne.Icon.drive)
                Text(trail.last?.name ?? "Paste the link")
                    .font(Nocturne.Face.title(24))
                    .foregroundStyle(Nocturne.text)
                    .lineLimit(2)

                if trail.count > 1 {
                    Button {
                        trail.removeLast()
                        if let up = trail.popLast() { Task { await list(up.id, name: up.name) } }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: Nocturne.Icon.back)
                            Text(trail[trail.count - 2].name)
                        }
                    }
                    .buttonStyle(TextButtonStyle(size: 14))
                    .disabled(busy != nil)
                }

                if trail.isEmpty {
                    Text("To the folder the scans are in, or to one scan. It has to be shared \u{201C}Anyone with the link\u{201D}. No Google account needed.")
                        .font(Nocturne.Face.body(13))
                        .foregroundStyle(Nocturne.text(62))
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 8) {
                    TextField(trail.isEmpty ? "https://drive.google.com/\u{2026}" : "Or paste another link", text: $link)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .onSubmit { Task { await open(link) } }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: Nocturne.Radius.base).fill(Nocturne.surface))
                    PasteButton(payloadType: String.self) { strings in
                        guard let first = strings.first else { return }
                        link = first
                        Task { await open(first) }
                    }
                    .labelStyle(.iconOnly)
                }

                if let busy {
                    HStack(spacing: 8) {
                        ProgressView().tint(Nocturne.accent)
                        Text(busy).font(Nocturne.Face.label(13)).foregroundStyle(Nocturne.text(60))
                    }
                }

                if let problem {
                    Text(problem)
                        .font(Nocturne.Face.label(12))
                        .foregroundStyle(Nocturne.accent400)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(files) { file in
                            Button {
                                if file.isFolder {
                                    Task { await list(file.id, name: file.name) }
                                } else {
                                    Task { await download(file.id, name: file.name, size: Int64(file.size ?? "")) }
                                }
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: file.isFolder ? "folder" : Nocturne.Icon.scan)
                                        .foregroundStyle(Nocturne.accent)
                                    Text(file.name).lineLimit(2)
                                    Spacer(minLength: 0)
                                    if file.isFolder {
                                        Image(systemName: Nocturne.Icon.forward).foregroundStyle(Nocturne.text(40))
                                    }
                                }
                                .font(Nocturne.Face.label(15))
                                .foregroundStyle(Nocturne.text)
                                .padding(.vertical, 13)
                                .contentShape(Rectangle())
                            }
                            .disabled(busy != nil)
                            Divider().overlay(Nocturne.divider)
                        }
                    }
                }

                Button("Cancel") { dismiss() }
                    .buttonStyle(TextButtonStyle())
                    .frame(maxWidth: .infinity)
            }
            .pageMargin()
        }
        .task {
            guard trail.isEmpty else { return }
            // Where the last cleanup left off, else the chapter's folder if the
            // build names one (GOOGLE_DRIVE_FOLDER_ID), else a link is pasted.
            if !savedFolder.isEmpty {
                await list(savedFolder, name: savedFolderName.isEmpty ? "Google Drive" : savedFolderName)
            } else if let root = DriveConfig.current?.folderId {
                await list(root, name: "Scans")
            }
        }
    }

    private func open(_ text: String) async {
        problem = nil
        switch DrivePublic.parse(text) {
        case .file(let id):
            await download(id, name: "drive-scan.pdf", size: nil)
        case .folder(let id):
            trail = []
            await list(id, name: "Shared folder")
            link = ""
        case nil:
            problem = "That is not a Google Drive link."
        }
    }

    private func list(_ id: String, name: String) async {
        busy = "Looking in the folder\u{2026}"
        problem = nil
        defer { busy = nil }
        do {
            let found = try await DrivePublic.list(folder: id, config: DriveConfig.current)
            files = found
            trail.append((id, name))
            savedFolder = id
            savedFolderName = name
            if found.isEmpty { problem = "No PDFs or folders in there." }
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func download(_ id: String, name: String, size: Int64?) async {
        busy = "Downloading \(name)\u{2026}"
        problem = nil
        do {
            let file = try await DrivePublic.download(id: id, name: name, expectedSize: size) { _ in }
            busy = nil
            dismiss()
            onOpened(file)
        } catch {
            busy = nil
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
