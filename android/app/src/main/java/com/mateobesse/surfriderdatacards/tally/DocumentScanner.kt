//
//  Photographing the cards.
//
//  WHY THIS IS A DOCUMENT SCANNER AND NOT A CAMERA. The same reason as
//  DocumentScanner.swift: "a photograph held at an angle keystones, and
//  registration corrects rotation and scale but not that." ML Kit's document
//  scanner finds the page's four corners and rectifies the perspective before
//  handing the image over, so the pipeline receives a flat page. It runs inside
//  Google Play services, which is why this app needs no camera permission.
//
//  SCANNER_MODE_BASE, on purpose. The other modes add filters and an ML
//  "clean up" that erases marks it takes for smudges -- and a faint pencil tally
//  is exactly the kind of mark it would take for one. Base mode is crop, rotate
//  and reorder, and nothing that touches the ink.
//
//  WHAT IS STILL UNMEASURED is resolution, exactly as on iOS. The reading wants
//  200 DPI on the card's short edge; whether a handheld capture clears that has
//  never been measured on a real card. So the button is gated -- see
//  `Beta.cameraCapture` in CaptureScreen.kt.
//

package com.mateobesse.surfriderdatacards.tally

import android.content.Context
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.pdf.PdfDocument
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import java.io.File
import kotlin.math.roundToInt

object CapturedPages {

    /**
     * Is there a scanner to scan with? The scanner lives in Google Play
     * services, so a phone without them has none -- and the button says so
     * rather than launching something that will not come up.
     */
    fun scanningAvailable(context: Context): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    fun scanner(): GmsDocumentScanner = GmsDocumentScanning.getClient(
        GmsDocumentScannerOptions.Builder()
            // Nothing reads the photo library, here or on iOS.
            .setGalleryImportAllowed(false)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_BASE)
            .build(),
    )

    /**
     * Bind the captured pages into a PDF the existing pipeline can read.
     *
     * A PDF rather than a new engine entry point on purpose: everything
     * downstream is measured on 1,606 pages of exactly that input.
     *
     * THE PAGE SIZE IS THE WHOLE POINT OF THIS FUNCTION. `pdf.ts` renders at
     * 200 DPI and PDF space is 72 points to the inch, so a page laid out at
     * `pixels * 72/200` rasterizes back to the pixels the camera captured
     * rather than a resampling of them. Android's PdfDocument takes whole
     * points, so the page lands within a point of that -- under three pixels
     * at 200 DPI, and the image is embedded at its own resolution either way.
     *
     * The scanner's own PDF output is not used because its page size is
     * whatever ML Kit chose, which is the resampling this avoids.
     *
     * Blocking; call it off the main thread.
     */
    fun pdf(context: Context, pages: List<Uri>): ScanFile {
        val document = PdfDocument()
        try {
            pages.forEachIndexed { index, uri ->
                // ImageDecoder applies the capture's orientation on the way in;
                // a page delivered sideways would be refused by registration for
                // a reason nobody could see. Software-allocated because a PDF
                // canvas cannot draw a hardware bitmap.
                val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, _, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
                val width = (bitmap.width * 72f / 200f).roundToInt().coerceAtLeast(1)
                val height = (bitmap.height * 72f / 200f).roundToInt().coerceAtLeast(1)
                val page = document.startPage(PdfDocument.PageInfo.Builder(width, height, index + 1).create())
                page.canvas.drawBitmap(bitmap, null, Rect(0, 0, width, height), Paint(Paint.FILTER_BITMAP_FLAG))
                document.finishPage(page)
                bitmap.recycle()
            }

            // Named the way the iOS capture names it. The chapter's filename
            // convention it does not follow, so nothing is seeded from it.
            val name = "photographed-cards.pdf"
            val file = File(Incoming.freshDirectory(context), name)
            file.outputStream().use { document.writeTo(it) }
            return ScanFile(file, name)
        } finally {
            document.close()
        }
    }
}
