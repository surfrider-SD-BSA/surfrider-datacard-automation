//
//  The printed blank cards, photographed in software: drawn at an angle on a
//  dark table, found, flattened and bound into a PDF. No camera, so this says
//  the geometry is right; it says nothing about focus, light or a real table.
//

import CoreImage
import PDFKit
import UIKit
import XCTest

final class PageFlattenerTests: XCTestCase {
    private let flattener = PageFlattener()

    private func blank(_ name: String) throws -> CIImage {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "png"))
        return try XCTUnwrap(CIImage(contentsOf: url))
    }

    /// A 12 MP frame, with the card at these corners (as fractions of it).
    private func photo(of card: CIImage, corners: ScanQuad) -> CIImage {
        let frame = CGRect(x: 0, y: 0, width: 3024, height: 4032)
        func point(_ p: CGPoint) -> CIVector { CIVector(x: p.x * frame.width, y: p.y * frame.height) }
        let warped = card.applyingFilter("CIPerspectiveTransform", parameters: [
            "inputTopLeft": point(corners.topLeft),
            "inputTopRight": point(corners.topRight),
            "inputBottomRight": point(corners.bottomRight),
            "inputBottomLeft": point(corners.bottomLeft),
        ])
        return warped
            .composited(over: CIImage(color: CIColor(red: 0.13, green: 0.12, blue: 0.1)).cropped(to: frame))
            .cropped(to: frame)
    }

    /// The top edge 20% short of the bottom, and the card a little turned: a
    /// phone held noticeably off straight, about as bad as gets through.
    private let keystoned = ScanQuad(
        topLeft: CGPoint(x: 0.19, y: 0.82), topRight: CGPoint(x: 0.81, y: 0.84),
        bottomRight: CGPoint(x: 0.90, y: 0.15), bottomLeft: CGPoint(x: 0.12, y: 0.13)
    )

    private func correlation(_ a: [UInt8], _ b: [UInt8]) -> Double {
        let ma = a.reduce(0.0) { $0 + Double($1) } / Double(a.count)
        let mb = b.reduce(0.0) { $0 + Double($1) } / Double(b.count)
        var ab = 0.0, aa = 0.0, bb = 0.0
        for i in a.indices {
            let x = Double(a[i]) - ma, y = Double(b[i]) - mb
            ab += x * y; aa += x * x; bb += y * y
        }
        return ab / (aa * bb).squareRoot()
    }

    func testCornersAreFound() throws {
        for name in ["blank-front", "blank-back"] {
            let scene = photo(of: try blank(name), corners: keystoned)
            let found = try XCTUnwrap(flattener.findCard(in: scene))
            print("scan-test \(name) corners off by \(found.movement(from: keystoned))")
            XCTAssertLessThan(found.movement(from: keystoned), 0.02, name)
        }
    }

    func testAnEmptyTableIsNoCard() {
        let table = CIImage(color: CIColor(red: 0.13, green: 0.12, blue: 0.1))
            .cropped(to: CGRect(x: 0, y: 0, width: 3024, height: 4032))
        XCTAssertNil(flattener.findCard(in: table))
    }

    /// Against the card it started as. The whole reason for this screen: a plain
    /// photograph of the same scene, only cropped, does not match.
    func testFlatteningUndoesTheKeystone() throws {
        for name in ["blank-front", "blank-back"] {
            let card = try blank(name)
            let scene = photo(of: card, corners: keystoned)
            let found = try XCTUnwrap(flattener.findCard(in: scene))
            let flat = try XCTUnwrap(flattener.flatten(scene, quad: found))

            // Coarse on purpose: the corners are found to within a few pixels and
            // registration takes up the rest, and thin lines a few pixels apart
            // would score nothing.
            let w = 120, h = 155
            let original = flattener.gray(card, width: w, height: h)
            let flattened = flattener.gray(flat, width: w, height: h)
            let xs = keystoned.corners.map(\.x), ys = keystoned.corners.map(\.y)
            let box = CGRect(
                x: xs.min()! * 3024, y: ys.min()! * 4032,
                width: (xs.max()! - xs.min()!) * 3024, height: (ys.max()! - ys.min()!) * 4032
            )
            let plain = flattener.gray(scene.cropped(to: box), width: w, height: h)

            let withFlatten = correlation(original, flattened)
            let without = correlation(original, plain)
            print("scan-test \(name) match with flatten \(withFlatten), plain crop \(without)")
            XCTAssertGreaterThan(withFlatten, 0.85)
            XCTAssertLessThan(without, withFlatten - 0.2)
        }
    }

    func testFlatPageIsLetterShaped() throws {
        let scene = photo(of: try blank("blank-front"), corners: keystoned)
        let flat = try XCTUnwrap(flattener.flatten(scene, quad: keystoned))
        XCTAssertEqual(flat.extent.height / flat.extent.width, 11.0 / 8.5, accuracy: 0.002)
        XCTAssertEqual(flat.extent.minX, 0, accuracy: 0.5)
        XCTAssertEqual(flat.extent.minY, 0, accuracy: 0.5)
    }

    /// From flat page to the PDF `read(pdf:)` is handed: a page at the card's
    /// real width and 200 DPI, however many pages there are.
    func testPagesReachThePdfAtTheCardsSize() async throws {
        let store = ScanPageStore(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let scene = photo(of: try blank("blank-front"), corners: keystoned)
        let flat = try XCTUnwrap(flattener.flatten(scene, quad: keystoned))
        let page = try XCTUnwrap(flattener.jpeg(flattener.enhanced(flat)))
        for _ in 0..<26 { try store.append(page) }  // past Apple's 24

        let file = try await store.pdf()
        let document = try XCTUnwrap(PDFDocument(url: file))
        XCTAssertEqual(document.pageCount, 26)
        let box = try XCTUnwrap(document.page(at: 25)).bounds(for: .mediaBox)
        XCTAssertEqual(box.width, 612, accuracy: 0.5)
        XCTAssertEqual(box.height, 792, accuracy: 1)
    }

    /// The blur check, on what there is to test it with. Prints the scores: the
    /// threshold in `PageMeasures.minimumSharpness` was read off them.
    func testSharpnessSeparatesBlur() throws {
        for name in ["blank-front", "blank-back"] {
            let card = try blank(name)
            let w = PageFlattener.measureWidth, h = PageFlattener.measureHeight
            func score(_ radius: Double) -> Double {
                let image = radius > 0 ? card.clampedToExtent().applyingGaussianBlur(sigma: radius).cropped(to: card.extent) : card
                return PageMeasures.sharpness(gray: flattener.gray(image, width: w, height: h), width: w, height: h)
            }
            let sharp = score(0), soft = score(2), blurred = score(4), lost = score(8)
            print("scan-test \(name) sharpness sharp \(sharp), 2px \(soft), 4px \(blurred), 8px \(lost)")
            XCTAssertGreaterThanOrEqual(sharp, PageMeasures.minimumSharpness)
            XCTAssertLessThan(blurred, PageMeasures.minimumSharpness)
            XCTAssertLessThan(lost, PageMeasures.minimumSharpness)
        }
    }

    func testFrontsAndBacksAreToldApart() throws {
        let w = PageFlattener.measureWidth, h = PageFlattener.measureHeight
        for (name, side) in [("blank-front", PageMeasures.Side.front), ("blank-back", .back)] {
            let pixels = flattener.gray(try blank(name), width: w, height: h)
            XCTAssertEqual(PageMeasures.side(gray: pixels, width: w, height: h), side, name)
        }
    }

    /// The same, on what the check actually sees: found, flattened and cleaned up.
    func testSidesSurviveTheFlatteningAndCleanup() throws {
        for (name, side) in [("blank-front", PageMeasures.Side.front), ("blank-back", .back)] {
            let scene = photo(of: try blank(name), corners: keystoned)
            let found = try XCTUnwrap(flattener.findCard(in: scene))
            let flat = try XCTUnwrap(flattener.flatten(scene, quad: found))
            XCTAssertEqual(flattener.side(of: flat), side, "\(name) flattened")
            XCTAssertEqual(flattener.side(of: flattener.enhanced(flat)), side, "\(name) cleaned up")
        }
    }

    /// The page-change check on real print. Prints the scores.
    func testFingerprintsTellThePagesApart() throws {
        let front = try blank("blank-front"), back = try blank("blank-back")
        let printFront = flattener.measure(front).fingerprint
        let printBack = flattener.measure(back).fingerprint

        // The same page found a little differently.
        let nudged = front.cropped(to: front.extent.insetBy(dx: 12, dy: 12))
        let printNudged = flattener.measure(nudged).fingerprint

        // The next card's front: same print, with writing on it.
        var scribbled = front
        for row in 0..<30 {
            let stroke = CIImage(color: CIColor(red: 0.2, green: 0.2, blue: 0.25))
                .cropped(to: CGRect(x: 260 + (row % 3) * 40, y: 200 + row * 62, width: 90, height: 6))
            scribbled = stroke.composited(over: scribbled)
        }
        let printScribbled = flattener.measure(scribbled.cropped(to: front.extent)).fingerprint

        let frontBack = printFront.similarity(to: printBack)
        let same = printFront.similarity(to: printNudged)
        let otherCard = printFront.similarity(to: printScribbled)
        print("scan-test fingerprint front/back \(frontBack), same page nudged \(same), same print with writing \(otherCard)")
        XCTAssertLessThan(frontBack, AutoCapture.differentBelow)
        XCTAssertGreaterThan(same, AutoCapture.differentBelow)
    }

    /// Light pencil has to come through the shadow and paper cleanup.
    func testEnhancingKeepsPencil() throws {
        let size = CGSize(width: 850, height: 1100)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let card = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor(white: 0.85, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor(white: 0.55, alpha: 1).setFill()  // pale pencil
            context.fill(CGRect(x: 300, y: 500, width: 60, height: 3))
        }
        let image = try XCTUnwrap(CIImage(image: card))
        let enhanced = flattener.enhanced(image)
        let w = Int(size.width), h = Int(size.height)
        let pixels = flattener.gray(enhanced, width: w, height: h)
        let stroke = Int(pixels[501 * w + 330]), paper = Int(pixels[300 * w + 330])
        print("scan-test pencil stroke \(stroke) on paper \(paper) after enhancing")
        XCTAssertGreaterThan(paper - stroke, 40)
    }
}
