//
//  Choosing a scan off the phone.
//
//  This is `UIDocumentPickerViewController` directly rather than SwiftUI's
//  `.fileImporter`, for two reasons, both of which were failures in practice.
//
//  IT HAS TO ACTUALLY PRESENT. `.fileImporter` was attached to the same view as
//  a `.fullScreenCover`, and stacking two presentation modifiers on one view is
//  a well-worn way to get one of them silently ignored -- the button appears
//  dead, with nothing in the log to say why. A representable presented from its
//  own `.sheet` has no such interaction.
//
//  IT HAS TO BE READABLE AFTERWARDS. `asCopy: true` copies the chosen file into
//  this app's own temp directory and hands back a plain URL. The alternative is
//  a security-scoped URL readable only between `startAccessingSecurityScopedResource`
//  and its matching stop -- and the read here happens later, on WebKit's thread,
//  inside the scheme handler. A copy removes that whole class of problem for the
//  cost of one file write.
//

import SwiftUI
import UniformTypeIdentifiers

struct PDFPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        // PDFs, and anything the system is not sure about. A scan that arrived
        // by AirDrop or as a mail attachment sometimes carries no useful type,
        // and greying it out is indistinguishable from the picker being broken.
        // Anything that is not really a PDF fails in the reader with a message,
        // which is a better outcome than an un-selectable file and no reason.
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: [.pdf, .data],
            asCopy: true
        )
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true
        return picker
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        private let parent: PDFPicker

        init(_ parent: PDFPicker) { self.parent = parent }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { parent.onCancel(); return }
            parent.onPick(url)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            parent.onCancel()
        }
    }
}
