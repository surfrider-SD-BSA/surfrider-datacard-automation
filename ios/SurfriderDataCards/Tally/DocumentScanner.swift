//
//  Photographing the cards.
//
//  WHY THIS IS VISIONKIT AND NOT A CAMERA.
//
//  Image input was removed from this app once before, deliberately, and the
//  reason is in ios/README.md: "a photograph held at an angle keystones, and
//  registration corrects rotation and scale but not that." That objection is
//  correct and it is fatal to a plain camera. `VNDocumentCameraViewController`
//  is the answer to it -- it finds the page's four corners and rectifies the
//  perspective before handing the image over, so what reaches the pipeline is
//  a flat page rather than a trapezoid. It is also the scanner UI people
//  already know from Notes and Files.
//
//  WHAT IS STILL UNMEASURED. Resolution. `src/lib/pdf.ts` rasterizes at 200 DPI
//  because that is what the chapter's ScanSnap produces and what the cell map's
//  coordinates are in. A rectified phone capture of a letter card lands roughly
//  there, and "roughly" is doing real work in that sentence -- nobody has
//  measured it on a real card in beach light. `pageSize` below is written so
//  that whatever pixels the camera gives are the pixels the pipeline sees,
//  rather than being thrown away by a rounding to some arbitrary page size.
//  That is the most this can do until someone measures it.
//

import PDFKit
import SwiftUI
import UIKit
import VisionKit

/// The system document scanner, wrapped so SwiftUI can present it.
struct DocumentScanner: UIViewControllerRepresentable {
    /// The rectified pages, in the order they were captured.
    let onFinish: ([UIImage]) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        private let parent: DocumentScanner

        init(_ parent: DocumentScanner) { self.parent = parent }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFinishWith scan: VNDocumentCameraScan
        ) {
            var pages: [UIImage] = []
            for index in 0..<scan.pageCount { pages.append(scan.imageOfPage(at: index)) }
            parent.onFinish(pages)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            parent.onCancel()
        }

        func documentCameraViewController(
            _ controller: VNDocumentCameraViewController,
            didFailWithError error: Error
        ) {
            parent.onCancel()
        }
    }
}

// MARK: -

enum CapturedPages {
    /// Is there a camera to scan with? False on a simulator, and on any device
    /// where the scanner is unavailable -- the button says so rather than
    /// presenting a controller that will not come up.
    static var scanningAvailable: Bool { VNDocumentCameraViewController.isSupported }

    /// Bind the captured pages into a PDF the existing pipeline can read.
    ///
    /// A PDF rather than a new engine entry point on purpose: `rasterizePdf`,
    /// `registerAgainstBestSide` and everything after them are measured on
    /// 1,606 pages, and the cheapest way to keep that true is to hand them the
    /// only input they have ever been measured on.
    ///
    /// THE PAGE SIZE IS THE WHOLE POINT OF THIS FUNCTION. `pdf.ts` renders at
    /// 200 DPI, and PDF user space is 72 units to the inch, so a page laid out
    /// at `pixels * 72/200` points rasterizes back to exactly the pixels the
    /// camera captured. Lay it out at any other size -- letter, say -- and the
    /// capture is resampled on the way in, which is throwing away the
    /// resolution this whole path exists to preserve.
    static func pdf(from pages: [UIImage]) throws -> URL {
        let dpi: CGFloat = 200
        let renderer = UIGraphicsPDFRenderer(bounds: .zero)

        let data = renderer.pdfData { context in
            for page in pages {
                guard let cgImage = page.cgImage else { continue }
                let size = CGSize(
                    width: CGFloat(cgImage.width) * 72 / dpi,
                    height: CGFloat(cgImage.height) * 72 / dpi
                )
                let bounds = CGRect(origin: .zero, size: size)
                context.beginPage(withBounds: bounds, pageInfo: [:])
                // Drawn through UIImage so the capture's orientation is applied
                // rather than ignored; a page delivered sideways would be
                // refused by registration for a reason nobody could see.
                page.draw(in: bounds)
            }
        }

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // Named the way a scan from the chapter's scanner is named, so the
        // date and beach seeding in the engine has something to read.
        let file = dir.appendingPathComponent("photographed-cards.pdf")
        try data.write(to: file)
        return file
    }
}
