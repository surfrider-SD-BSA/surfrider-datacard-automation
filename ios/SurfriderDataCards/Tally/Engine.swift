//
//  The reading pipeline, driven from Swift.
//
//  There is no Swift implementation of the reading in this app and there should
//  never be one. Registration, tally counting and digit recognition are
//  measured in HANDOFF.md against the TypeScript in src/, on 1,606 pages, and a
//  port would be a second implementation to keep in step with a set of figures
//  that took months to establish. So the same modules run here, in a WKWebView
//  with no interface attached: src/engine.ts is the other half of this file.
//
//  A fix to the reading is therefore a change to src/, followed by
//  ios/sync-web.sh. It is never a change to anything in this folder.
//
//  WHY THE WEB VIEW IS IN THE HIERARCHY. It is one point square at zero
//  opacity, which looks like a trick and is not: WebKit throttles timers in a
//  web view that is not part of a window, and `rasterizePdf` yields between
//  pages so that a progress bar can paint. Throttled, that yield turns a
//  116-page scan into several extra minutes of nothing. Attached and invisible,
//  it runs at full speed. See `EngineHost`, which RootView places.
//

import Foundation
import SwiftUI
import WebKit

// MARK: - What comes back

struct ScanCell: Decodable, Identifiable, Hashable {
    struct Prefill: Decodable, Hashable {
        let value: Int
        let confidence: Double
        /// "tally" | "digits" | "agreed" | "split" -- which reader spoke.
        let source: String

        /// Whether the engine took this reading as the answer, which means this
        /// cell is not on the review list and nobody will be shown it.
        ///
        /// Optional, and absent means false: the app ships a copy of the web
        /// bundle and a build against a stale one should put every cell in
        /// front of a person rather than none. `AUTO_ACCEPT` in
        /// src/lib/prefill.ts is where the threshold lives and what it costs.
        let autoAccepted: Bool?

        var takenAsRead: Bool { autoAccepted == true }

        /// What to call this box, in the reviewer's words.
        ///
        /// The reader is named because they are not worth the same and the
        /// reviewer is entitled to know which claim they are being asked to
        /// check. "read" is the weakest of the three and is named differently
        /// on purpose. Mirrors `prefillTag` in src/lib/prefill.ts.
        var tag: String {
            switch source {
            case "digits": return "read: check it"
            case "agreed": return "counted twice: check it"
            // Nothing was read in this cell. The number in the box is a
            // starting point and not a claim, and saying so is the only thing
            // that separates it from a reading on screen.
            case "placeholder": return "nothing read: type it"
            default: return "counted: check it"
            }
        }
    }

    let row: Int
    let itemName: String
    let section: String
    let side: String
    let hasValue: Bool
    let tallyOnly: Bool
    let pageNumber: Int
    let prefill: Prefill?

    var id: Int { row }
}

struct ScanCard: Decodable, Identifiable, Hashable {
    let cardNumber: Int
    /// Card 1 is column C. Never inferred from where the ink is.
    let column: String
    let missingSides: [String]
    let cells: [ScanCell]

    var id: Int { cardNumber }
}

struct ScanPage: Decodable, Hashable {
    let pageNumber: Int
    let side: String
    let trusted: Bool
    /// How well the printed section banners landed. The figure a refusal is
    /// made on, and the one screen 5 shows rather than a generic failure.
    let bannerOverlap: Double
}

struct ScanProblem: Decodable, Hashable {
    let kind: String
    let message: String
    let pages: [Int]
}

struct ScanSeed: Decodable, Hashable {
    let date: String
    let shoreline: String
}

struct ScanResult: Decodable {
    let fileName: String
    let fileSize: Int
    let pageCount: Int
    let seeded: ScanSeed?
    let pages: [ScanPage]
    let minBannerOverlap: Double
    let problems: [ScanProblem]
    let cards: [ScanCard]
}

struct CropResult: Decodable {
    let width: Int
    let height: Int
    /// Base64 PNG. Not a data URL -- the prefix would only be stripped here.
    let png: String

    var image: UIImage? {
        Data(base64Encoded: png).flatMap(UIImage.init(data:))
    }
}

struct ExportResult: Decodable {
    let filename: String
    let xlsx: String

    var bytes: Data? { Data(base64Encoded: xlsx) }
}

struct EngineProgress {
    /// "opening" | "reading" | "pairing" | "done"
    var stage: String = "opening"
    var fraction: Double = 0
    var pageNumber: Int?
    var total: Int?
}

/// A method that answers `{ ok: true }` and nothing else.
struct EngineAck: Decodable {}

enum EngineError: LocalizedError {
    case notReady
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .notReady: return "The reader has not finished starting up."
        case .failed(let message): return message
        }
    }
}

// MARK: -

@MainActor
final class Engine: NSObject, ObservableObject {

    /// True once engine.html has parsed and the reference card is in memory.
    @Published private(set) var ready = false
    @Published private(set) var progress = EngineProgress()

    private var webView: WKWebView!
    private var nextID = 1
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var loadedContinuations: [CheckedContinuation<Void, Never>] = []
    private var loaded = false

    override init() {
        super.init()

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebAssetSchemeHandler(), forURLScheme: WebAssetSchemeHandler.scheme)
        config.userContentController.add(self, name: "tally")

        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.isUserInteractionEnabled = false
        // Safari's Web Inspector is the only way to see inside the pipeline
        // once it is in the app. iOS 16.4 and up; the deployment target is
        // 16.0, so it is asked for rather than assumed.
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        var components = URLComponents()
        components.scheme = WebAssetSchemeHandler.scheme
        components.host = WebAssetSchemeHandler.host
        components.path = "/engine.html"
        webView.load(URLRequest(url: components.url!))
    }

    /// The view RootView plants so the web view is in a window. Invisible.
    var host: some View { EngineHost(webView: webView) }

    // MARK: - Starting up

    /// Load the reference card, the cell maps and the digit model.
    ///
    /// Worth doing before the volunteer has anything to wait for: it is a few
    /// megabytes off local storage, and doing it here means the reading starts
    /// the moment a scan arrives rather than a second later.
    func open() async {
        await waitForLoad()
        let _: EngineAck? = try? await call("open", params: [String: String]())
        ready = true
    }

    private func waitForLoad() async {
        if loaded { return }
        await withCheckedContinuation { continuation in
            loadedContinuations.append(continuation)
        }
    }

    // MARK: - Work

    /// Read a scan into cards and cells.
    ///
    /// The PDF is staged in the scheme handler's inbox and fetched by the page,
    /// rather than passed as a string: a scan is tens of megabytes, and base64
    /// through `evaluateJavaScript` would be that again with a JavaScript
    /// parser in front of it.
    func process(pdf url: URL, onProgress: @escaping (EngineProgress) -> Void) async throws -> ScanResult {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let token = WebAssetSchemeHandler.stage(url)
        defer { WebAssetSchemeHandler.unstage(token) }

        progressObserver = onProgress
        defer { progressObserver = nil }

        return try await call("process", params: [
            "url": "\(WebAssetSchemeHandler.scheme)://\(WebAssetSchemeHandler.host)/__inbox/\(token)",
            "fileName": url.lastPathComponent,
            "fileSize": size,
        ] as [String: Any])
    }

    /// One cell's picture. `kind` is "total", "marks" or "context".
    func crop(card: Int, row: Int, kind: String = "total") async throws -> CropResult {
        try await call("crop", params: ["cardNumber": card, "row": row, "kind": kind] as [String: Any])
    }

    func export(_ input: [String: Any]) async throws -> ExportResult {
        try await call("export", params: input)
    }

    /// Let go of a scan's crops.
    func reset() async {
        let _: EngineAck? = try? await call("reset", params: [String: String]())
    }

    // MARK: - The bridge

    private var progressObserver: ((EngineProgress) -> Void)?

    private func call<T: Decodable>(_ method: String, params: Any) async throws -> T {
        await waitForLoad()

        let id = nextID
        nextID += 1

        let body: [String: Any] = ["id": id, "method": method, "params": params]
        guard
            let json = try? JSONSerialization.data(withJSONObject: body),
            let text = String(data: json, encoding: .utf8),
            let literal = try? JSONSerialization.data(withJSONObject: [text]),
            let quoted = String(data: literal, encoding: .utf8)
        else { throw EngineError.failed("could not encode the request") }

        // `quoted` is a one-element JSON array, so dropping the brackets leaves
        // a correctly escaped JavaScript string literal. Hand-escaping this is
        // how injection bugs are written.
        let argument = String(quoted.dropFirst().dropLast())

        let data: Data = try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            webView.evaluateJavaScript("window.tally.dispatch(\(argument))") { [weak self] _, error in
                guard let error else { return }
                Task { @MainActor in
                    self?.pending.removeValue(forKey: id)?.resume(throwing: error)
                }
            }
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw EngineError.failed("the reader sent back something unexpected: \(error)")
        }
    }
}

// MARK: -

extension Engine: WKScriptMessageHandler {
    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? String, let data = body.data(using: .utf8) else { return }
        receive(data)
    }

    private func receive(_ data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        if let event = object["event"] as? String {
            switch event {
            case "loaded":
                loaded = true
                for continuation in loadedContinuations { continuation.resume() }
                loadedContinuations.removeAll()
            case "progress":
                let update = EngineProgress(
                    stage: object["stage"] as? String ?? "reading",
                    fraction: object["fraction"] as? Double ?? 0,
                    pageNumber: object["pageNumber"] as? Int,
                    total: object["total"] as? Int
                )
                progress = update
                progressObserver?(update)
            default:
                break
            }
            return
        }

        guard let id = object["id"] as? Int, let continuation = pending.removeValue(forKey: id) else { return }

        if object["ok"] as? Bool == true {
            let result = object["result"] ?? [String: Any]()
            if let encoded = try? JSONSerialization.data(withJSONObject: result) {
                continuation.resume(returning: encoded)
            } else {
                continuation.resume(throwing: EngineError.failed("could not read the reply"))
            }
        } else {
            continuation.resume(throwing: EngineError.failed(object["error"] as? String ?? "the reader failed"))
        }
    }
}

extension Engine: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        // Our own bundle and nothing else. "The scan never leaves the device"
        // is the tool's first promise, and this is the line where it would
        // break -- a stray link, an injected script, a typo in a future
        // version. Refused rather than quietly loaded.
        let scheme = navigationAction.request.url?.scheme
        decisionHandler(scheme == WebAssetSchemeHandler.scheme ? .allow : .cancel)
    }
}

// MARK: - The crops, kept and fetched ahead

/// The pictures screen 6 reads from, held in memory and fetched before they are
/// asked for.
///
/// A crop is cheap and a long way away: JavaScript cuts the row out of the page
/// it is still holding, encodes a PNG and posts it back as base64, and the app
/// then decodes it twice. None of that is slow on its own. Done on arrival it
/// was all in front of the tap, three times over -- the box, the row strip and
/// the marks were awaited one after another -- so every "Next" on a screen
/// somebody works for an hour spent a white card and a spinner before it showed
/// anything. That, and not the reading, is what made the app feel slow.
///
/// So the work moves behind the tap. The cell on screen is fetched, and the
/// next few are fetched after it while the reviewer is still reading this one.
/// Advancing then hits memory and paints in the same frame.
@MainActor
final class CropCache {

    struct Key: Hashable {
        let card: Int
        let row: Int
        /// "total" | "context" | "marks", as `crop` in src/engine.ts names them.
        let kind: String
    }

    private let engine: Engine

    private var images: [Key: UIImage] = [:]
    /// Insertion order, oldest first. A decoded crop is a bitmap and an event is
    /// hundreds of cells, so this is bounded rather than left to grow into the
    /// second copy of the scan the engine went to some trouble not to keep.
    private var order: [Key] = []
    private var inFlight: [Key: Task<UIImage?, Never>] = [:]

    /// Comfortably more than the window that is prefetched, and far short of an
    /// event.
    private let limit = 48

    /// Bumped by `clear`. A fetch already in the air when the scan goes belongs
    /// to a card that is no longer loaded, and must not land in the cache the
    /// next scan will read from.
    private var generation = 0

    init(engine: Engine) { self.engine = engine }

    /// What is in memory now, for a caller that cannot wait -- which is the
    /// checking screen's body, every frame.
    func cached(_ key: Key) -> UIImage? { images[key] }

    /// The picture, from memory if it is there and from the engine if it is not.
    ///
    /// Two callers wanting the same crop share one round trip: the screen asks
    /// for the cell it is showing at the same moment the prefetch the previous
    /// cell started is still in the air, and that is the common case rather than
    /// a race worth ignoring.
    func image(_ key: Key) async -> UIImage? {
        if let hit = images[key] { return hit }
        if let running = inFlight[key] { return await running.value }

        let era = generation
        let task = Task<UIImage?, Never> { [engine] in
            guard let result = try? await engine.crop(card: key.card, row: key.row, kind: key.kind) else { return nil }
            let png = result.png
            // Base64, the PNG decode, and the bitmap the renderer actually
            // draws, all off the main thread. Left alone, the last of those
            // three happens on the first frame the picture is on screen, which
            // is the one frame that must not drop.
            return await Task.detached(priority: .userInitiated) {
                guard let data = Data(base64Encoded: png), let image = UIImage(data: data) else { return nil }
                return image.preparingForDisplay() ?? image
            }.value
        }

        inFlight[key] = task
        let image = await task.value
        inFlight.removeValue(forKey: key)
        if let image, era == generation { store(key, image) }
        return image
    }

    /// The picture, or nothing where this cell has none to show. Saves the
    /// caller a branch around three parallel fetches.
    func image(_ key: Key, when needed: Bool) async -> UIImage? {
        needed ? await image(key) : nil
    }

    /// Fetch ahead and do not wait. Anything already held or already asked for
    /// falls straight through `image`.
    func prefetch(_ keys: [Key]) {
        for key in keys where images[key] == nil && inFlight[key] == nil {
            Task { _ = await image(key) }
        }
    }

    /// The crops belong to one scan and nothing in them outlives it. Same
    /// promise as the one on every screen: the pictures stay in memory and go
    /// when the event does.
    func clear() {
        generation += 1
        for task in inFlight.values { task.cancel() }
        inFlight = [:]
        images = [:]
        order = []
    }

    private func store(_ key: Key, _ image: UIImage) {
        if images[key] == nil { order.append(key) }
        images[key] = image
        while order.count > limit {
            images.removeValue(forKey: order.removeFirst())
        }
    }
}

// MARK: -

/// Plants the engine's web view in the window so WebKit does not throttle it.
private struct EngineHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}
}
