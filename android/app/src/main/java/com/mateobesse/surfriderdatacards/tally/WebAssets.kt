//
//  Serving the built web bundle to the engine's WebView.
//
//  WebAssetSchemeHandler.swift, for Android. The same two jobs, for the same
//  reasons.
//
//  NOT file:// URLs. The page fetches its reference card, its cell maps and
//  its 3.4MB digit model with `fetch()`, and a file:// page is an opaque origin
//  that cannot. Android reserves `appassets.androidplatform.net` for exactly
//  this: a real https origin that never touches the network, answered here
//  from the APK. The same code that works on a web server works unchanged.
//
//  MIME TYPES ARE SET EXPLICITLY, and the one that matters is the PDF worker.
//  `pdf.worker.min.mjs` served as anything but a JavaScript type is refused by
//  the module loader, and the app then sits on "Reading the cards" with nothing
//  in the log, because the failure is inside a worker nobody is watching. It
//  has cost this project a session on the web side and is set by hand in the
//  iOS handler for the same reason.
//
//  AND NOTHING ELSE IS ANSWERED. A request for any other host gets a refusal
//  from here, not the network. The app holds no INTERNET permission, so the
//  network would refuse it anyway; this is the second lock on the same door.
//

package com.mateobesse.surfriderdatacards.tally

import android.content.res.AssetManager
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class WebAssets(private val assets: AssetManager) {

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"

        /**
         * Where a scan is put so the page can `fetch()` it.
         *
         * A scan is tens of megabytes, and handing it over through
         * `evaluateJavascript` would be the whole scan as a JavaScript string
         * literal. So it is served as a resource instead: the file is staged
         * under a one-shot token, the page fetches `/__inbox/<token>`, and the
         * entry goes as soon as the read is done.
         *
         * A token rather than a path, so that nothing outside this map is
         * reachable whatever the page asks for.
         */
        private const val INBOX = "/__inbox/"
        private val inbox = ConcurrentHashMap<String, File>()

        fun stage(file: File): String = UUID.randomUUID().toString().also { inbox[it] = file }

        fun unstage(token: String) {
            inbox.remove(token)
        }

        /** The type and charset for a file in the bundle. */
        fun mimeType(extension: String): Pair<String, String?> = when (extension.lowercase()) {
            // .mjs is the one that bites. See the note at the top of this file.
            "mjs", "js" -> "text/javascript" to "utf-8"
            "html", "htm" -> "text/html" to "utf-8"
            "css" -> "text/css" to "utf-8"
            "json" -> "application/json" to "utf-8"
            "wasm" -> "application/wasm" to null
            "png" -> "image/png" to null
            "jpg", "jpeg" -> "image/jpeg" to null
            "svg" -> "image/svg+xml" to "utf-8"
            "xlsx" -> Spreadsheet.MIME to null
            else -> "application/octet-stream" to null
        }
    }

    /**
     * The answer to one request. Never null: a null would send the request on
     * to the network, and nothing this WebView asks for belongs there.
     */
    fun respond(url: Uri): WebResourceResponse {
        if (url.scheme != "https" || url.host != HOST) return refuse()

        var path = url.path.orEmpty()
        if (path.isEmpty() || path == "/") path = "/index.html"

        // A staged scan. Not a bundle path, so it is answered before the bundle
        // is consulted at all.
        if (path.startsWith(INBOX)) {
            val file = inbox[path.removePrefix(INBOX)] ?: return notFound()
            val stream = try {
                FileInputStream(file)
            } catch (e: IOException) {
                return notFound()
            }
            return ok("application/pdf" to null, stream, "no-store", length = file.length())
        }

        // Refuse anything that climbs out of the bundle. Nothing in the app
        // builds such a path, which is exactly why it should be impossible
        // rather than merely unused.
        val segments = url.pathSegments
        if (segments.isEmpty() || segments.any { it == ".." || it == "." || it.isEmpty() }) return refuse()
        val asset = "web/" + segments.joinToString("/")

        val stream = try {
            assets.open(asset)
        } catch (e: IOException) {
            // A real 404 rather than a failure, so the page's own fallbacks
            // run: `loadDigitModel` checks `res.ok` and drops to tally-only
            // reading, where a transport error would throw instead.
            return notFound()
        }

        // The bundle is immutable for the life of an install.
        return ok(mimeType(asset.substringAfterLast('.', "")), stream, "public, max-age=31536000, immutable")
    }

    private fun ok(type: Pair<String, String?>, stream: java.io.InputStream, cache: String, length: Long? = null) =
        WebResourceResponse(
            type.first,
            type.second,
            200,
            "OK",
            buildMap {
                put("Cache-Control", cache)
                if (length != null) put("Content-Length", length.toString())
            },
            stream,
        )

    private fun notFound() = WebResourceResponse(
        "text/plain", "utf-8", 404, "Not Found", emptyMap(),
        ByteArrayInputStream("not found".toByteArray()),
    )

    private fun refuse() = WebResourceResponse(
        "text/plain", "utf-8", 403, "Forbidden", emptyMap(),
        ByteArrayInputStream("this app does not use the network".toByteArray()),
    )
}
