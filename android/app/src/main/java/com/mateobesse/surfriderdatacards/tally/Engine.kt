//
//  The reading pipeline, driven from Kotlin.
//
//  There is no Kotlin implementation of the reading in this app and there
//  should never be one. Registration, tally counting and digit recognition are
//  measured in HANDOFF.md against the TypeScript in src/, on 1,606 pages, and a
//  port would be a second implementation to keep in step with figures that took
//  months to establish -- a third, counting the one iOS refused to write. So
//  the same modules run here, in a WebView with no interface attached:
//  src/engine.ts is the other half of this file, and the same file is the other
//  half of Engine.swift.
//
//  A fix to the reading is therefore a change to src/, followed by
//  android/sync-web.sh. It is never a change to anything in this folder.
//
//  THE PROTOCOL is the iOS one, unchanged. Kotlin calls
//  `window.tally.dispatch(json)`; every answer comes back as a string posted to
//  `window.tallyAndroid`, which is a WebMessageListener scoped to the app's own
//  origin (or, on a WebView too old for one, a JavascriptInterface).
//
//  WHY THE WEB VIEW IS IN THE HIERARCHY. One pixel, invisible, attached to the
//  window: see TallyApp.kt. Chromium treats a WebView that is not in a window
//  as a hidden page and throttles its timers, and `rasterizePdf` yields between
//  pages with `setTimeout`. Throttled, a 116-page scan takes minutes longer for
//  nothing. iOS plants its WKWebView for the same reason.
//

package com.mateobesse.surfriderdatacards.tally

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.mateobesse.surfriderdatacards.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.json.JSONObject
import java.io.File

// What comes back. The shapes are `process`, `crop` and `export` in
// src/engine.ts, and the same as the Decodables in Engine.swift.

@Serializable
data class Prefill(
    val value: Int,
    val confidence: Double,
    /** "tally" | "digits" | "agreed" | "split" | "placeholder" -- which reader spoke. */
    val source: String,
    /**
     * Whether the engine took this reading as the answer, which means this cell
     * is not on the review list and nobody will be shown it.
     *
     * Absent means false: a build against a stale bundle should put every cell
     * in front of a person rather than none. `AUTO_ACCEPT` in
     * src/lib/prefill.ts is where the threshold lives and what it costs.
     */
    val autoAccepted: Boolean? = null,
) {
    val takenAsRead: Boolean get() = autoAccepted == true

    /**
     * What to call this box, in the reviewer's words. The reader is named
     * because they are not worth the same. Mirrors `prefillTag` in
     * src/lib/prefill.ts, and `tag` in Engine.swift.
     */
    val tag: String
        get() = when (source) {
            "digits" -> "read: check it"
            "agreed" -> "counted twice: check it"
            "placeholder" -> "nothing read: type it"
            else -> "counted: check it"
        }
}

@Serializable
data class ScanCell(
    val row: Int,
    val itemName: String,
    val section: String,
    val side: String,
    val hasValue: Boolean = false,
    val tallyOnly: Boolean = false,
    val pageNumber: Int = 0,
    val prefill: Prefill? = null,
)

@Serializable
data class ScanCard(
    val cardNumber: Int,
    /** Card 1 is column C. Never inferred from where the ink is. */
    val column: String,
    val missingSides: List<String> = emptyList(),
    val cells: List<ScanCell>,
)

@Serializable
data class ScanPage(
    val pageNumber: Int,
    val side: String,
    val trusted: Boolean,
    /** How well the printed section banners landed. The figure a refusal is made on. */
    val bannerOverlap: Double,
)

@Serializable
data class ScanProblem(val kind: String, val message: String, val pages: List<Int> = emptyList())

@Serializable
data class ScanSeed(val date: String, val shoreline: String)

@Serializable
data class ScanResult(
    val fileName: String,
    val fileSize: Long,
    val pageCount: Int,
    val seeded: ScanSeed? = null,
    val pages: List<ScanPage>,
    val minBannerOverlap: Double,
    val problems: List<ScanProblem> = emptyList(),
    val cards: List<ScanCard>,
)

@Serializable
data class CropResult(
    val width: Int,
    val height: Int,
    /** Base64 PNG. Not a data URL. */
    val png: String,
)

@Serializable
data class ExportResult(val filename: String, @SerialName("xlsx") val base64: String)

data class EngineProgress(
    /** "opening" | "reading" | "pairing" | "done" */
    val stage: String = "opening",
    val fraction: Double = 0.0,
    val pageNumber: Int? = null,
    val total: Int? = null,
)

class EngineException(message: String) : Exception(message)

/** The one Json the app reads the engine and its own files with. */
val TallyJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

// -

/**
 * One instance for the life of the app: it holds the reference card, the cell
 * maps and the digit model, and re-reading those per scan would be several
 * seconds each time for nothing. Main thread throughout, like the WebView.
 */
class Engine(context: Context) {

    private val app = context.applicationContext
    private val assets = WebAssets(app.assets)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** True once engine.html has parsed and the reference card is in memory. */
    var ready by mutableStateOf(false)
        private set
    var progress by mutableStateOf(EngineProgress())
        private set

    /**
     * Bumped when the WebView is replaced. The root keys the view it plants on
     * this, so a replacement is planted in its turn.
     */
    var generation by mutableIntStateOf(0)
        private set

    /**
     * Told when the system killed the reader and it was started again. Whatever
     * scan it held is gone with it -- see `rendererGone`.
     */
    var onRestart: (() -> Unit)? = null

    private lateinit var webView: WebView
    private var nextId = 1
    private val pending = HashMap<Int, CompletableDeferred<JsonElement>>()
    private var loaded = CompletableDeferred<Unit>()
    private var progressObserver: ((EngineProgress) -> Unit)? = null

    /**
     * Every message from the page, in the order it was posted.
     *
     * Parsed off the main thread -- `process` answers with every cell of the
     * event in one string, and parsing that in the middle of a frame is felt --
     * but by one consumer, so a progress update can never overtake the one
     * before it.
     */
    private val inbox = Channel<String>(Channel.UNLIMITED)

    init {
        // Chrome's inspector is the only way to see inside the pipeline once
        // it is in the app. Debug builds only: a release build holds a scan in
        // this page, and USB debugging should not be a way to read it.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        scope.launch(Dispatchers.Default) {
            for (body in inbox) {
                val message = try {
                    TallyJson.parseToJsonElement(body).jsonObject
                } catch (e: SerializationException) {
                    continue
                } catch (e: IllegalArgumentException) {
                    continue
                }
                withContext(Dispatchers.Main) { receive(message) }
            }
        }
        build()
    }

    /** The view the root plants so the WebView is in a window. Invisible. */
    fun host(): View {
        (webView.parent as? ViewGroup)?.removeView(webView)
        return webView
    }

    // Starting up

    /**
     * Load the reference card, the cell maps and the digit model.
     *
     * Worth doing before the volunteer has anything to wait for: it is a few
     * megabytes off local storage, and doing it here means the reading starts
     * the moment a scan arrives.
     */
    suspend fun open() {
        try {
            raw("open", JsonObject(emptyMap()))
            if (BuildConfig.DEBUG) Log.d(TAG, "open: the reference card, cell maps and digit model are loaded")
        } catch (e: EngineException) {
            Log.w(TAG, "open: ${e.message}")
        }
        ready = true
    }

    // Work

    /**
     * Read a scan into cards and cells.
     *
     * The PDF is staged and fetched by the page rather than passed as a string;
     * see `WebAssets.stage`. `fileName` is the name the volunteer knows it by,
     * which is what the engine seeds the date and beach from and what a draft
     * is matched on.
     */
    suspend fun process(pdf: File, fileName: String, onProgress: (EngineProgress) -> Unit = {}): ScanResult {
        val token = WebAssets.stage(pdf)
        progress = EngineProgress()
        progressObserver = onProgress
        try {
            return call(
                "process",
                buildJsonObject {
                    put("url", "${WebAssets.ORIGIN}/__inbox/$token")
                    put("fileName", fileName)
                    put("fileSize", pdf.length())
                },
            )
        } finally {
            WebAssets.unstage(token)
            progressObserver = null
        }
    }

    /** One cell's picture. `kind` is "total", "marks" or "context". */
    suspend fun crop(card: Int, row: Int, kind: String = "total"): CropResult = call(
        "crop",
        buildJsonObject {
            put("cardNumber", card)
            put("row", row)
            put("kind", kind)
        },
    )

    suspend fun export(input: JsonObject): ExportResult = call("export", input)

    /** Let go of a scan's crops. */
    suspend fun reset() {
        try {
            raw("reset", JsonObject(emptyMap()))
        } catch (e: EngineException) {
            Log.w(TAG, "reset: ${e.message}")
        }
    }

    fun destroy() {
        scope.cancel()
        inbox.close()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    // The bridge

    private suspend inline fun <reified T> call(method: String, params: JsonElement): T {
        val result = raw(method, params)
        return withContext(Dispatchers.Default) {
            try {
                TallyJson.decodeFromJsonElement<T>(result)
            } catch (e: SerializationException) {
                throw EngineException("the reader sent back something unexpected: ${e.message}")
            } catch (e: IllegalArgumentException) {
                throw EngineException("the reader sent back something unexpected: ${e.message}")
            }
        }
    }

    private suspend fun raw(method: String, params: JsonElement): JsonElement = withContext(Dispatchers.Main.immediate) {
        loaded.await()

        val id = nextId++
        val request = buildJsonObject {
            put("id", id)
            put("method", method)
            put("params", params)
        }.toString()

        val reply = CompletableDeferred<JsonElement>()
        pending[id] = reply
        try {
            // `JSONObject.quote` is a correctly escaped string literal.
            // Hand-escaping this is how injection bugs are written.
            webView.evaluateJavascript("window.tally.dispatch(${JSONObject.quote(request)})", null)
            reply.await()
        } finally {
            pending.remove(id)
        }
    }

    private fun receive(message: JsonObject) {
        val event = message["event"]?.jsonPrimitive?.contentOrNull
        if (event != null) {
            when (event) {
                "loaded" -> {
                    if (BuildConfig.DEBUG) Log.d(TAG, "loaded: engine.html is parsed and listening")
                    loaded.complete(Unit)
                }
                "progress" -> {
                    val update = EngineProgress(
                        stage = message["stage"]?.jsonPrimitive?.contentOrNull ?: "reading",
                        fraction = message["fraction"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                        pageNumber = message["pageNumber"]?.jsonPrimitive?.intOrNull,
                        total = message["total"]?.jsonPrimitive?.intOrNull,
                    )
                    progress = update
                    progressObserver?.invoke(update)
                }
            }
            return
        }

        val id = message["id"]?.jsonPrimitive?.intOrNull ?: return
        val reply = pending.remove(id) ?: return
        if (message["ok"]?.jsonPrimitive?.booleanOrNull == true) {
            reply.complete(message["result"] ?: JsonObject(emptyMap()))
        } else {
            reply.completeExceptionally(
                EngineException(message["error"]?.jsonPrimitive?.contentOrNull ?: "the reader failed"),
            )
        }
    }

    // The WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun build() {
        val view = WebView(app)
        view.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            // Forced on anyway, because the app has no INTERNET permission.
            // Said here too, so that adding the permission one day does not
            // quietly open this page to the network.
            blockNetworkLoads = true
        }
        view.setBackgroundColor(Color.TRANSPARENT)
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // Scoped to the app's own origin, so no other page -- were one ever
            // to load here -- could post an answer to a question it was not asked.
            WebViewCompat.addWebMessageListener(view, "tallyAndroid", setOf(WebAssets.ORIGIN)) { _, message, _, isMainFrame, _ ->
                if (isMainFrame) message.data?.let { inbox.trySend(it) }
            }
        } else {
            view.addJavascriptInterface(LegacyBridge(inbox), "tallyAndroid")
        }

        view.webViewClient = Client()
        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) Log.d(TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        view.loadUrl("${WebAssets.ORIGIN}/engine.html")
        webView = view
    }

    /** For a WebView without WebMessageListener. Same shape, as src/engine.ts sees it. */
    class LegacyBridge(private val inbox: SendChannel<String>) {
        @JavascriptInterface
        fun postMessage(body: String) {
            inbox.trySend(body)
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
            assets.respond(request.url)

        /**
         * Our own bundle and nothing else. "The scan never leaves the device" is
         * the tool's first promise, and this is the line where it would break --
         * a stray link, an injected script, a typo in a future version.
         */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.host != WebAssets.HOST

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            rendererGone(view)
            return true
        }
    }

    /**
     * The system killed the page, which on a phone short of memory it may do in
     * the middle of a large scan. Returning without handling this takes the
     * whole app down with it; so the dead view is dropped, everything waiting
     * on it is told why, and a fresh one is started.
     *
     * The scan it held is gone -- the crops were only ever in that page -- and
     * the model is told so it can say that rather than show pictures that will
     * never arrive. The typing is not: it is in the draft.
     */
    private fun rendererGone(dead: WebView) {
        if (dead !== webView) return
        Log.w(TAG, "the reader's render process was killed; starting a new one")

        (dead.parent as? ViewGroup)?.removeView(dead)
        dead.destroy()

        val failure = EngineException(
            "The phone stopped the reader, usually because it ran short of memory. Closing other apps and trying again often gets through it.",
        )
        pending.values.forEach { it.completeExceptionally(failure) }
        pending.clear()
        loaded = CompletableDeferred()
        ready = false

        build()
        generation++
        onRestart?.invoke()
        scope.launch { open() }
    }

    private companion object {
        const val TAG = "TallyEngine"
    }
}

// The crops, kept and fetched ahead

/**
 * The pictures screen 6 reads from, held in memory and fetched before they are
 * asked for.
 *
 * A crop is cheap and a long way away: JavaScript cuts the row out of the page
 * it is still holding, encodes a PNG and posts it back as base64, and the app
 * then decodes it. Done on arrival, that is all in front of the tap, and every
 * "Next" on a screen somebody works for an hour spends a white card before it
 * shows anything. So the cell on screen is fetched, and the next few after it
 * while the reviewer is still reading this one. See CropCache in Engine.swift.
 *
 * The map is snapshot state, so a picture landing redraws exactly the screen
 * that is showing its cell and nothing else.
 */
class CropCache(private val engine: Engine, private val scope: CoroutineScope) {

    /** `kind` is "total" | "context" | "marks", as `crop` in src/engine.ts names them. */
    data class Key(val card: Int, val row: Int, val kind: String)

    private val images = mutableStateMapOf<Key, ImageBitmap>()
    private val failures = mutableStateMapOf<Key, Boolean>()

    /**
     * Insertion order, oldest first. A decoded crop is a bitmap and an event is
     * hundreds of cells, so this is bounded rather than left to grow into the
     * second copy of the scan the engine went to some trouble not to keep.
     */
    private val order = ArrayDeque<Key>()
    private val inFlight = HashMap<Key, Deferred<ImageBitmap?>>()

    /** Comfortably more than the window that is prefetched, and far short of an event. */
    private val limit = 48

    /**
     * Bumped by `clear`. A fetch already in the air when the scan goes belongs
     * to a card that is no longer loaded, and must not land in the cache the
     * next scan will read from.
     */
    private var generation = 0

    /** What is in memory now, for a caller that cannot wait: a screen, every frame. */
    fun cached(key: Key): ImageBitmap? = images[key]

    /** Whether this picture was asked for and could not be had. */
    fun failed(key: Key): Boolean = failures[key] == true

    /**
     * The picture, from memory if it is there and from the engine if it is not.
     * Two callers wanting the same crop share one round trip.
     */
    suspend fun image(key: Key): ImageBitmap? {
        images[key]?.let { return it }
        inFlight[key]?.let { return it.await() }

        val era = generation
        val task = scope.async {
            val result = try {
                engine.crop(key.card, key.row, key.kind)
            } catch (e: EngineException) {
                null
            } ?: return@async null
            // Base64, the PNG decode and the upload to the GPU, all off the main
            // thread. Left alone, the last of those happens on the first frame
            // the picture is on screen, which is the one frame that must not drop.
            withContext(Dispatchers.Default) {
                val bytes = Base64.decode(result.png, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { it.prepareToDraw() }?.asImageBitmap()
            }
        }

        inFlight[key] = task
        val image = try {
            task.await()
        } finally {
            if (inFlight[key] === task) inFlight.remove(key)
        }
        if (era == generation) {
            if (image != null) store(key, image) else failures[key] = true
        }
        return image
    }

    /** The picture, or nothing where this cell has none to show. */
    suspend fun image(key: Key, needed: Boolean): ImageBitmap? = if (needed) image(key) else null

    /** Fetch ahead and do not wait. */
    fun prefetch(keys: List<Key>) {
        for (key in keys) {
            if (images[key] == null && inFlight[key] == null) scope.launch { image(key) }
        }
    }

    /**
     * The crops belong to one scan and nothing in them outlives it. Same promise
     * as the one on every screen: the pictures stay in memory and go when the
     * event does.
     */
    fun clear() {
        generation++
        inFlight.values.forEach { it.cancel() }
        inFlight.clear()
        images.clear()
        failures.clear()
        order.clear()
    }

    private fun store(key: Key, image: ImageBitmap) {
        if (!images.containsKey(key)) order.addLast(key)
        images[key] = image
        while (order.size > limit) images.remove(order.removeFirst())
    }
}
