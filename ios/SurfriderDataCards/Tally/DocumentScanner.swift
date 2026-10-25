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
//  measured it on a real card in beach light. What is measured is scale:
//  registration only searches +/-6% around the reference, so every page is
//  laid out at the card's real width and resampled to 200 DPI on the way in.
//  See `CapturedPages.pdf`.
//

import PDFKit
import SwiftUI
import UIKit
import VisionKit

/// The system document scanner, wrapped so SwiftUI can present it.
struct DocumentScanner: UIViewControllerRepresentable {
    /// The rectified pages, in the order they were captured. Handed over as
    /// the scan rather than as images: a cleanup is 100+ pages, and decoding
    /// them all at once is gigabytes of camera-sized bitmaps.
    let onFinish: (VNDocumentCameraScan) -> Void
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
            parent.onFinish(scan)
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
    /// THE PAGE SIZE IS THE WHOLE POINT OF THIS FUNCTION. VisionKit crops to
    /// the paper's edges, so a page is one card, and the card is US letter
    /// wide. Each page is laid out 612 points (8.5 in) across its short edge,
    /// whichever way it was held, and stored at 200
    /// DPI, which is what the chapter's scanner produces and what `pdf.ts`
    /// rasterizes at. This used to keep the camera's own pixels instead, laid
    /// out at `pixels * 72/200`: a 12 MP capture then reached registration at
    /// about 1.7x the reference, far outside the +/-6% `fitAxis` searches, and
    /// every page was refused (measured 18 Oct 2026 on the 1.18 Imperial scan
    /// rendered at 340 DPI: banner overlap 0.02-0.22, all 8 refused; at 200
    /// DPI, 0.86-0.93, none refused).
    ///
    /// One page at a time, each in its own autorelease pool, and each stored
    /// as JPEG, so memory stays at one page whatever the length of the scan.
    static func pdf(from scan: VNDocumentCameraScan) throws -> URL {
        try pdf(pageCount: scan.pageCount) { scan.imageOfPage(at: $0) }
    }

    static func pdf(pageCount: Int, page: (Int) -> UIImage) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        // Named the way a scan from the chapter's scanner is named, so the
        // date and beach seeding in the engine has something to read.
        let file = dir.appendingPathComponent("photographed-cards.pdf")
        guard let pdf = CGContext(file as CFURL, mediaBox: nil, nil) else {
            throw CaptureError.couldNotWrite
        }

        for index in 0..<pageCount {
            try autoreleasepool {
                let image = page(index)
                // `size` has the orientation applied; `cgImage` does not.
                guard image.size.width > 0, image.size.height > 0 else { return }
                // The SHORT edge is the card's 8.5 inches: a card photographed
                // sideways comes back landscape, registration turns it upright,
                // and scaling its long edge to 8.5 in would leave it at ~77%.
                let scale = pageWidthPixels / min(image.size.width, image.size.height)
                let pixels = CGSize(
                    width: (image.size.width * scale).rounded(),
                    height: (image.size.height * scale).rounded()
                )
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                format.opaque = true
                // Drawn through UIImage so the capture's orientation is applied
                // rather than ignored; a page delivered sideways would be
                // refused by registration for a reason nobody could see.
                let jpeg = UIGraphicsImageRenderer(size: pixels, format: format)
                    .jpegData(withCompressionQuality: jpegQuality) { context in
                        // The default is a fast filter that drops thin pencil
                        // strokes when it shrinks a 12 MP capture to 200 DPI.
                        context.cgContext.interpolationQuality = .high
                        image.draw(in: CGRect(origin: .zero, size: pixels))
                    }
                guard
                    let provider = CGDataProvider(data: jpeg as CFData),
                    let flat = CGImage(
                        jpegDataProviderSource: provider, decode: nil,
                        shouldInterpolate: true, intent: .defaultIntent
                    )
                else { throw CaptureError.couldNotWrite }

                var box = CGRect(
                    x: 0, y: 0,
                    width: pixels.width * 72 / dpi, height: pixels.height * 72 / dpi
                )
                pdf.beginPage(mediaBox: &box)
                pdf.draw(flat, in: box)
                pdf.endPage()
            }
        }
        pdf.closePDF()
        return file
    }

    /// Join several camera sessions into the one PDF a cleanup is read from.
    ///
    /// The document camera stops at 24 pages a session -- twelve cards, front
    /// and back -- so a pile bigger than that is scanned in rounds. Reading
    /// each round as its own cleanup gave Eric three spreadsheets for one
    /// South Ponto pile (24 Oct 2026). The pages go in session order, which is
    /// card order as long as each round carried on where the last one stopped.
    static func merge(_ files: [URL]) throws -> URL {
        if files.count == 1, let only = files.first { return only }
        let joined = PDFDocument()
        for file in files {
            guard let part = PDFDocument(url: file) else { throw CaptureError.couldNotWrite }
            for index in 0..<part.pageCount {
                guard let page = part.page(at: index) else { continue }
                joined.insert(page, at: joined.pageCount)
            }
        }
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("photographed-cards.pdf")
        guard joined.write(to: file) else { throw CaptureError.couldNotWrite }
        return file
    }

    /// The scan with one page swapped for a new photograph of it.
    ///
    /// For a page that was refused: rather than scanning the whole pile again,
    /// the volunteer photographs that one card side and the rest stays as read.
    /// `pageNumber` is 1-based, as the refusal names it.
    static func replacing(page pageNumber: Int, in file: URL, with scan: VNDocumentCameraScan) throws -> URL {
        guard scan.pageCount > 0, let document = PDFDocument(url: file),
              (1...document.pageCount).contains(pageNumber)
        else { throw CaptureError.couldNotWrite }
        let photo = try pdf(pageCount: 1) { _ in scan.imageOfPage(at: 0) }
        guard let page = PDFDocument(url: photo)?.page(at: 0) else { throw CaptureError.couldNotWrite }
        document.removePage(at: pageNumber - 1)
        document.insert(page, at: pageNumber - 1)

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent(file.lastPathComponent)
        guard document.write(to: out) else { throw CaptureError.couldNotWrite }
        return out
    }

    /// What `pdf.ts` rasterizes at, and what the cell map's coordinates are in.
    private static let dpi: CGFloat = 200
    /// High enough that the JPEG is not what the digit reader sees.
    private static let jpegQuality: CGFloat = 0.95
    /// A letter card's 8.5 inches at that resolution.
    private static let pageWidthPixels: CGFloat = 8.5 * dpi

    enum CaptureError: LocalizedError {
        case couldNotWrite
        var errorDescription: String? { "the PDF could not be written" }
    }
}
