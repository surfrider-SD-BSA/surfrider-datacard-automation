//
//  Serving the built web bundle to WKWebView.
//
//  Not file:// URLs. The page fetches its reference card, its cell maps and its
//  3.4MB digit model with `fetch()`, and WKWebView refuses cross-origin fetches
//  from file:// -- every one of them fails and the app opens to a tool that
//  cannot read anything. A custom scheme is treated as a proper origin, so the
//  same code that works on a web server works here unchanged.
//
//  MIME types are set explicitly and this matters more than it looks. The PDF
//  worker is `pdf.worker.min.mjs`, and a .mjs served as anything other than a
//  JavaScript type is rejected by the module loader: the app then hangs on
//  "Reading the PDF..." with nothing in the console, because the failure is in
//  a worker nobody is watching. That exact symptom has already cost this
//  project a session on the web side.
//

import Foundation
import WebKit
import UniformTypeIdentifiers

final class WebAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "cleanup"
    static let host = "app"

    /// Where a scan is put so the page can `fetch()` it.
    ///
    /// The engine needs the PDF and the PDF is tens of megabytes. Handing it
    /// over as base64 through `evaluateJavaScript` means the whole scan as a
    /// JavaScript string literal, parsed by JavaScriptCore, on a phone. This
    /// serves it as a resource instead: Swift stages the file under a
    /// one-shot token, the page fetches `/__inbox/<token>`, and the entry is
    /// removed as soon as the read is done.
    ///
    /// A token rather than a path so that nothing outside this map is
    /// reachable, whatever the page asks for.
    private static let inboxPrefix = "/__inbox/"
    private static let inboxLock = NSLock()
    nonisolated(unsafe) private static var inbox: [String: URL] = [:]

    static func stage(_ url: URL) -> String {
        let token = UUID().uuidString
        inboxLock.lock()
        inbox[token] = url
        inboxLock.unlock()
        return token
    }

    static func unstage(_ token: String) {
        inboxLock.lock()
        inbox.removeValue(forKey: token)
        inboxLock.unlock()
    }

    private static func staged(_ token: String) -> URL? {
        inboxLock.lock()
        defer { inboxLock.unlock() }
        return inbox[token]
    }

    /// The `web` folder inside the app bundle: a copy of `dist/`.
    private let root: URL

    override init() {
        guard let root = Bundle.main.url(forResource: "web", withExtension: nil) else {
            fatalError("the web bundle is missing from the app: run ios/sync-web.sh and rebuild")
        }
        self.root = root
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        // Strip the query and fragment: the bundle is static files, and a
        // cache-busting `?v=` must not turn into a missing file.
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        // A staged scan, if that is what was asked for. Not a bundle path, so
        // it is answered before the bundle is consulted at all.
        if path.hasPrefix(Self.inboxPrefix) {
            let token = String(path.dropFirst(Self.inboxPrefix.count))
            guard let file = Self.staged(token), let data = try? Data(contentsOf: file) else {
                Self.respondNotFound(url: url, task: task)
                return
            }
            Self.respond(url: url, data: data, mimeType: "application/pdf", cache: "no-store", task: task)
            return
        }

        // Refuse anything that climbs out of the bundle. Nothing in the app
        // constructs such a path, which is exactly why it should be impossible
        // rather than merely unused.
        let resolved = root.appendingPathComponent(path).standardizedFileURL
        guard resolved.path.hasPrefix(root.standardizedFileURL.path) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: resolved) else {
            // A real 404 rather than a failure, so the page's own fallbacks run.
            // `loadDigitModel` checks res.ok and drops to tally-only reading; a
            // transport error would throw instead.
            Self.respondNotFound(url: url, task: task)
            return
        }

        // The bundle is immutable for the life of an install.
        Self.respond(
            url: url,
            data: data,
            mimeType: Self.mimeType(for: resolved.pathExtension),
            cache: "public, max-age=31536000, immutable",
            task: task
        )
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func respond(
        url: URL, data: Data, mimeType: String, cache: String, task: WKURLSchemeTask
    ) {
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mimeType,
                "Content-Length": String(data.count),
                "Cache-Control": cache,
            ]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private static func respondNotFound(url: URL, task: WKURLSchemeTask) {
        let response = HTTPURLResponse(
            url: url, statusCode: 404, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/plain"]
        )!
        task.didReceive(response)
        task.didReceive(Data("not found".utf8))
        task.didFinish()
    }

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        // .mjs is the one that bites: UTType does not know it, and the module
        // loader rejects anything that is not a JavaScript type.
        case "mjs", "js": return "text/javascript; charset=utf-8"
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "wasm": return "application/wasm"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        default:
            return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
