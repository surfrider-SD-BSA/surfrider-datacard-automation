// Rasterize a scanned PDF to page JPEGs, matching what the web app sees.
//
// The offline scripts (build-reference, detect-cells, extract-crops,
// diagnose-shift, label-from-spreadsheet) all take a directory of page JPEGs,
// but nothing in the repo produced one -- the images were made by hand. This
// closes that gap so a scan can be taken from PDF to diagnosis in one step.
//
// The scale matters: src/lib/pdf.ts renders at 200 DPI against each page's own
// PDF box, so page pixel dimensions vary with the scanner's page size. This
// reproduces that exactly rather than normalizing to a fixed pixel size, which
// would hide the very scale variation registration has to cope with.
//
//   swift scripts/render-pdf.swift <in.pdf> <out-dir> [dpi]

import Foundation
import CoreGraphics
import ImageIO
import PDFKit
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: render-pdf.swift <in.pdf> <out-dir> [dpi]\n".data(using: .utf8)!)
    exit(2)
}
let inPath = args[1]
let outDir = args[2]
let dpi = args.count > 3 ? (Double(args[3]) ?? 200) : 200
let scale = dpi / 72.0

guard let doc = PDFDocument(url: URL(fileURLWithPath: inPath)) else {
    FileHandle.standardError.write("cannot open \(inPath)\n".data(using: .utf8)!)
    exit(1)
}
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let colorSpace = CGColorSpaceCreateDeviceGray()

for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i), let cgPage = page.pageRef else { continue }
    let box = cgPage.getBoxRect(.mediaBox)
    let rotation = cgPage.rotationAngle
    let swap = rotation == 90 || rotation == 270
    let ptW = swap ? box.height : box.width
    let ptH = swap ? box.width : box.height
    let w = Int((ptW * scale).rounded())
    let h = Int((ptH * scale).rounded())

    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: 0, space: colorSpace,
                              bitmapInfo: CGImageAlphaInfo.none.rawValue) else { continue }
    // Scans are opaque; a transparent backdrop would read as ink downstream.
    ctx.setFillColor(gray: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.scaleBy(x: scale, y: scale)
    ctx.drawPDFPage(cgPage)

    guard let image = ctx.makeImage() else { continue }
    let name = String(format: "page-%03d.jpg", i + 1)
    let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
    CGImageDestinationFinalize(dest)
    print("\(name)  \(w)x\(h)")
}
