//
//  Google's picker, in a web view, and the flow around it.
//
//  The web view is here for one reason, stated at the top of docs/ios-picker.html
//  and worth repeating where somebody will actually be reading: the `drive.file`
//  scope can only be exercised through Google's Picker, the Picker is a
//  JavaScript library, and it will only run on an origin registered with
//  Google. So the picking happens on a published page and everything else --
//  the sign-in, the download, the reading -- is native.
//
//  WHAT GOES IN AND WHAT COMES OUT. A token in, through the URL fragment so it
//  reaches no server; a file id, name and size out, through one message
//  handler. The page is given no other way to talk to the app: `DriveMessage`
//  is the entire vocabulary, anything that does not decode is dropped, and the
//  web view has no access to the model, the scan or the values.
//

import SwiftUI
import WebKit

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
        /// The picker is up, choosing a folder to save into.
        case choosingFolder(URL)
        case uploading(name: String)
        /// The spreadsheet is in Drive. Held rather than cleared so the screen
        /// can say so -- a save that leaves no trace looks like one that did
        /// not happen.
        case saved(name: String)
    }

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
    func begin() async {
        guard let config else { return }
        problem = nil
        stage = .authorizing
        do {
            let token = try await auth.accessToken(for: config)
            stage = .picking(pickerURL(token: token, config: config))
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

    func cancel() {
        stage = .idle
    }

    // MARK: - The other direction

    /// Step one of saving: a token, then the picker in folder mode.
    ///
    /// A folder has to be chosen even though DriveConfig may name one. Under
    /// `drive.file` this app cannot write into a folder it merely knows the id
    /// of; access comes from the picker handing the folder back. See the note
    /// at the top of DriveUpload.
    func beginSave() async {
        guard let config else { return }
        problem = nil
        stage = .authorizing
        do {
            let token = try await auth.accessToken(for: config)
            stage = .choosingFolder(pickerURL(token: token, config: config, mode: "folder"))
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

// MARK: - The web view

struct DrivePicker: UIViewRepresentable {

    let url: URL
    let onMessage: (DriveMessage) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onMessage: onMessage) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "picker")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        // Nothing is kept. The page has no storage to speak of, and a token
        // that outlived the sheet would be the one thing DriveAuth exists to
        // prevent.
        configuration.websiteDataStore = .nonPersistent()

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor(Nocturne.ground)
        view.scrollView.backgroundColor = UIColor(Nocturne.ground)
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        // The handler holds the coordinator, which holds the callback, which
        // holds the screen. Left attached, the whole chain outlives the sheet.
        view.configuration.userContentController.removeScriptMessageHandler(forName: "picker")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private let onMessage: (DriveMessage) -> Void

        init(onMessage: @escaping (DriveMessage) -> Void) {
            self.onMessage = onMessage
        }

        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let decoded = DriveMessage(body: message.body) else { return }
            onMessage(decoded)
        }

        /// A page that will not load at all -- aeroplane mode, GitHub Pages
        /// down, a fork that never published its copy -- otherwise shows an
        /// empty sheet with no explanation.
        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onMessage(.failed("The picker page could not be loaded: \(error.localizedDescription)"))
        }
    }
}
