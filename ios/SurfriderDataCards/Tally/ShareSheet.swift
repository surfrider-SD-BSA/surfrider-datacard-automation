//
//  Getting the spreadsheet out.
//
//  The share sheet is how a file leaves an app on iOS: Files, AirDrop, Mail,
//  whatever the chapter's data person wants. The web build reached it through a
//  blob download that WKWebView had to be talked into; the engine hands back
//  bytes, so this is just a file on disk and the system sheet over it.
//

import SwiftUI
import UIKit

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
