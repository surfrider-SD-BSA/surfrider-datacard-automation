//
//  Finding a card in a picture and flattening it.
//
//  This is what answers the objection in ios/README.md, that a photograph held
//  at an angle keystones and registration cannot correct that. Vision finds the
//  page's corners and Core Image pulls them back to a rectangle, as Apple's
//  document camera does, so the reader gets a flat page.
//

import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

final class PageFlattener {
    /// Width a page is drawn at to measure it: 100 DPI on a letter card.
    static let measureWidth = 850
    static let measureHeight = 1100
    /// A letter card's long edge over its short edge.
    static let letterAspect: CGFloat = 11.0 / 8.5

    /// No colour management beyond plain RGB, so `side` compares against the
    /// same 0-255 values the reader's `inkFraction` does.
    private let context = CIContext(options: [
        .workingColorSpace: CGColorSpaceCreateDeviceRGB(),
        .outputColorSpace: CGColorSpaceCreateDeviceRGB(),
    ])

    // MARK: Finding

    /// The card's corners, or nil. The document model first, because it is
    /// trained on paper; plain rectangles if it finds nothing or cannot run.
    /// A sideways card still counts as found, so it can be told to turn.
    /// Looks at a small copy: corners need no more detail than this, and a frame
    /// and a 12 MP photo then get the same treatment.
    func findCard(in image: CIImage) -> ScanQuad? {
        let longest = max(image.extent.width, image.extent.height)
        let small = longest > Self.findSize
            ? image.transformed(by: CGAffineTransform(scaleX: Self.findSize / longest, y: Self.findSize / longest))
            : image
        let handler = VNImageRequestHandler(ciImage: small, options: [:])

        // Both can be sure of something that is not the card: on a simulator the
        // document model has answered with a strip of bare table, and rectangles
        // with the printed grid inside the card. So only a card's shape counts,
        // and among rectangles, the biggest.
        func plausible(_ quad: ScanQuad) -> Bool {
            ScanPosition.cardAspects.contains(quad.aspect(in: small.extent.size)) && !Self.isWholeFrame(quad)
        }

        let document = VNDetectDocumentSegmentationRequest()
        if (try? handler.perform([document])) != nil,
           let found = document.results?.first.map(ScanQuad.init), plausible(found) {
            return found
        }

        let rectangles = VNDetectRectanglesRequest()
        rectangles.minimumAspectRatio = 0.6
        rectangles.maximumAspectRatio = 0.9
        rectangles.minimumSize = 0.2
        rectangles.quadratureTolerance = 30
        rectangles.maximumObservations = 8
        if (try? handler.perform([rectangles])) != nil {
            return (rectangles.results ?? [])
                .map(ScanQuad.init)
                .filter(plausible)
                .max { $0.area < $1.area }
        }
        return nil
    }

    private static let findSize: CGFloat = 1024

    /// The whole frame is what the document model says when it found no edge.
    private static func isWholeFrame(_ quad: ScanQuad) -> Bool {
        quad.corners.allSatisfy { min($0.x, 1 - $0.x) < 0.02 && min($0.y, 1 - $0.y) < 0.02 }
    }

    // MARK: Flattening

    /// The card, pulled square, at the camera's own resolution and at exactly a
    /// letter card's proportions.
    ///
    /// The proportions are set rather than measured because foreshortening
    /// makes corners unreliable for them and the card's shape is known. `pdf`
    /// then fixes the short edge at 8.5 inches, so both directions arrive at
    /// the reader at 200 DPI. Only for a shape near a card's; anything else
    /// is passed through rather than stretched. The limits are looser than
    /// `ScanPosition.cardAspects` because this measures after the correction.
    func flatten(_ image: CIImage, quad: ScanQuad) -> CIImage? {
        let extent = image.extent
        func point(_ p: CGPoint) -> CGPoint {
            CGPoint(x: extent.minX + p.x * extent.width, y: extent.minY + p.y * extent.height)
        }
        let filter = CIFilter.perspectiveCorrection()
        filter.inputImage = image
        filter.topLeft = point(quad.topLeft)
        filter.topRight = point(quad.topRight)
        filter.bottomRight = point(quad.bottomRight)
        filter.bottomLeft = point(quad.bottomLeft)
        filter.crop = true
        guard let flat = filter.outputImage else { return nil }

        let moved = flat.transformed(by: CGAffineTransform(
            translationX: -flat.extent.minX, y: -flat.extent.minY
        ))
        let width = moved.extent.width, height = moved.extent.height
        guard width > 0, height > 0 else { return nil }
        guard (1.05...1.9).contains(max(width, height) / min(width, height)) else { return moved }
        let scale = height >= width
            ? CGAffineTransform(scaleX: 1, y: width * Self.letterAspect / height)
            : CGAffineTransform(scaleX: height * Self.letterAspect / width, y: 1)
        return moved.transformed(by: scale)
    }

    /// Shadows evened out and the paper whitened, nearer to what the chapter's
    /// scanner produces and to what Apple's camera hands over. UNMEASURED
    /// against the reader: if the comparison on real cards shows pencil being
    /// lost, this is the first thing to turn off.
    func enhanced(_ page: CIImage) -> CIImage {
        let filter = CIFilter.documentEnhancer()
        filter.inputImage = page
        return filter.outputImage?.cropped(to: page.extent) ?? page
    }

    // MARK: Measuring

    /// Gray pixels, top row first, with the page stretched to fit.
    func gray(_ page: CIImage, width: Int, height: Int) -> [UInt8] {
        let extent = page.extent
        guard extent.width > 0, extent.height > 0 else { return [] }
        let colourless = page
            .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0])
            .transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
        let scaleX = CGFloat(width) / extent.width, scaleY = CGFloat(height) / extent.height
        // A photograph shrinks a lot, and must average its ink rather than keep
        // or drop it by chance. A frame is near this size already and comes up
        // eight times a second, so it gets the cheap way.
        let sized: CIImage
        if scaleY < 0.7 {
            let filter = CIFilter.lanczosScaleTransform()
            filter.inputImage = colourless
            filter.scale = Float(scaleY)
            filter.aspectRatio = Float(scaleX / scaleY)
            let scaled = filter.outputImage ?? colourless
            sized = scaled.transformed(by: CGAffineTransform(
                translationX: -scaled.extent.minX, y: -scaled.extent.minY
            ))
        } else {
            sized = colourless.samplingLinear()
                .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        }
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        context.render(
            sized, toBitmap: &rgba, rowBytes: width * 4,
            bounds: CGRect(x: 0, y: 0, width: width, height: height),
            format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB()
        )
        var out = [UInt8](repeating: 0, count: width * height)
        // CIContext's bitmap has the top row first.
        for index in out.indices { out[index] = rgba[index * 4] }
        return out
    }

    /// Turned upright if it is landscape, so a page matches itself however it
    /// was laid. Which way round does not matter: `similarity` tries both.
    private func portrait(_ page: CIImage) -> CIImage {
        page.extent.width > page.extent.height ? page.oriented(.right) : page
    }

    func measure(_ page: CIImage) -> (sharpness: Double, fingerprint: PageFingerprint) {
        let upright = portrait(page)
        let pixels = gray(upright, width: Self.measureWidth, height: Self.measureHeight)
        return (
            PageMeasures.sharpness(gray: pixels, width: Self.measureWidth, height: Self.measureHeight),
            PageFingerprint(gray: PageMeasures.shrunk(
                gray: pixels, width: Self.measureWidth, height: Self.measureHeight,
                toWidth: PageFingerprint.width, toHeight: PageFingerprint.height
            ))
        )
    }

    /// Nil for a sideways page, whose top is not at the top.
    func side(of page: CIImage) -> PageMeasures.Side? {
        guard page.extent.height >= page.extent.width else { return nil }
        let pixels = gray(page, width: Self.measureWidth, height: Self.measureHeight)
        return PageMeasures.side(gray: pixels, width: Self.measureWidth, height: Self.measureHeight)
    }

    // MARK: Saving

    /// High enough that the JPEG is not what the digit reader sees; the same
    /// figure as `CapturedPages`.
    func jpeg(_ page: CIImage, quality: CGFloat = 0.95) -> Data? {
        context.jpegRepresentation(
            of: page, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]
        )
    }

    func thumbnail(_ page: CIImage, width: CGFloat) -> UIImage? {
        guard page.extent.width > 0 else { return nil }
        let scale = width / page.extent.width
        let small = page.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = context.createCGImage(small, from: small.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

extension ScanQuad {
    init(_ observation: VNRectangleObservation) {
        self.init(
            topLeft: observation.topLeft, topRight: observation.topRight,
            bottomRight: observation.bottomRight, bottomLeft: observation.bottomLeft
        )
    }
}
