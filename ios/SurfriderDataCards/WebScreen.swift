//
//  The WKWebView itself, and the two things it needs help with.
//
//  DOWNLOADS. The whole point of the tool is that it hands back a filled
//  spreadsheet, and the web page does that the web way: build a blob, click an
//  <a download>. In WKWebView that is a navigation to a blob: URL which is
//  cancelled, silently -- the button appears to do nothing. So downloads are
//  intercepted, written to a temp file and handed to the share sheet, which is
//  how a file leaves an app on iOS anyway: Files, AirDrop, Mail, whatever the
//  data person wants.
//
//  THE CAMERA. `<input type="file" accept="image/*" capture="environment">`
//  brings up the native picker on its own; what it needs is the usage strings
//  in Info.plist, and iOS kills the app without them.
//

import SwiftUI
import UIKit
import WebKit

struct WebScreen: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebAssetSchemeHandler(), forURLScheme: WebAssetSchemeHandler.scheme)

        // The review list is a scroll of images; letting them play inline and
        // keeping the page out of the "mobile reader" path avoids reflow.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        context.coordinator.webView = webView

        // Safari's Web Inspector can attach, which is the only way to debug the
        // page once it is inside the app. iOS 16.4 and up; the deployment
        // target is 16.0, so it is asked for rather than assumed.
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        var components = URLComponents()
        components.scheme = WebAssetSchemeHandler.scheme
        components.host = WebAssetSchemeHandler.host
        components.path = "/index.html"
        webView.load(URLRequest(url: components.url!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        weak var webView: WKWebView?
        private var pendingDownloadURL: URL?

        // --- keeping the promise that nothing is uploaded --------------------

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            // Our own bundle, or a download. Anything else -- a stray link, an
            // injected script, a typo in a future version -- is refused rather
            // than quietly loaded, because "the scan never leaves the laptop"
            // is the tool's first promise and this is where it would break.
            if url.scheme == WebAssetSchemeHandler.scheme || url.scheme == "blob" || url.scheme == "data" {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }

        // --- downloads -------------------------------------------------------

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            // A fresh directory each time: the exporter suggests the same
            // filename for the same event, and overwriting fails the download
            // rather than replacing the file.
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

            let name = suggestedFilename.isEmpty ? "cleanup-data.xlsx" : suggestedFilename
            let target = dir.appendingPathComponent(name)
            pendingDownloadURL = target
            completionHandler(target)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let url = pendingDownloadURL else { return }
            pendingDownloadURL = nil
            present(fileAt: url)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            pendingDownloadURL = nil
            presentAlert(
                title: "The spreadsheet could not be saved",
                message: error.localizedDescription
            )
        }

        private func present(fileAt url: URL) {
            guard let source = topViewController() else { return }
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // Required on iPad, where a share sheet without an anchor crashes.
            share.popoverPresentationController?.sourceView = source.view
            share.popoverPresentationController?.sourceRect = CGRect(
                x: source.view.bounds.midX, y: source.view.bounds.maxY - 40, width: 1, height: 1
            )
            source.present(share, animated: true)
        }

        private func presentAlert(title: String, message: String) {
            guard let top = topViewController() else { return }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            top.present(alert, animated: true)
        }

        private func topViewController() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            var top = scene?.keyWindow?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            return top
        }
    }
}
