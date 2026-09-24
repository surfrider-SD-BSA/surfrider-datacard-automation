//
//  Everything the eight screens read from, and the only place a value lives.
//
//  TallyModel.swift, for Android, and the same rule at the top of it:
//  `values` IS THE TRUTH. `assertTypedValues` in src/main.ts exists because a
//  browser restored form state into boxes that had become different items, and
//  three cells came back pre-filled against items nobody had typed for. That
//  is the one outcome this tool must never produce.
//
//  The Android analogue is the system restoring a text field's contents, or
//  autofill reaching into one. Screen 6 answers it the way iOS does, by
//  construction: the number is typed on a keypad this app draws, into a String
//  this model owns. There is no text field in the path.
//

package com.mateobesse.surfriderdatacards.tally

import android.app.Application
import android.net.Uri
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.io.File

/** One cell, with the card it came from. */
data class FlatCell(
    val key: CellKey,
    /** Card 1 is column C. Straight from the engine, never recomputed here. */
    val column: String,
    val cell: ScanCell,
)

enum class Screen { Event, Capture, Reading, Refused, Review, Cards, Finish }

class TallyModel(application: Application) : AndroidViewModel(application) {

    private val app: Application get() = getApplication()

    /**
     * The engine is built with the model and reached through it. One instance
     * for the life of the app; see Engine.kt.
     */
    val engine = Engine(application)

    /** The cell pictures, kept and fetched ahead of the reviewer. */
    val crops = CropCache(engine, viewModelScope)

    val chapter = "Surfrider San Diego · CH54"

    // Navigation

    /**
     * The push stack, root excluded. Empty is screen 1. Owned here, as
     * `path` is on iOS, so the model can move the reviewer the way it does
     * there -- replace the stack, pop two screens at once, append.
     */
    val path = mutableStateListOf<Screen>()

    // The event

    var event by mutableStateOf(EventForm())

    // The scan

    var scan by mutableStateOf<ScanResult?>(null)
        private set

    /**
     * Every cell the tool found something in, review list or not. What gets
     * exported is seeded from here, because most of it is never shown.
     */
    var allCells by mutableStateOf<List<FlatCell>>(emptyList())
        private set

    /**
     * The review list: the cells the tool did NOT take as read. A cell above
     * `AUTO_ACCEPT` (src/lib/prefill.ts) is not in here, and no screen in this
     * app will show it. See the same note in TallyModel.swift.
     */
    var cells by mutableStateOf<List<FlatCell>>(emptyList())
        private set

    /** How many cells were taken as read and kept off the list. */
    val takenAsReadCount: Int get() = allCells.size - cells.size

    var reading by mutableStateOf(false)
        private set
    var readingError by mutableStateOf<String?>(null)
        private set

    /**
     * A PDF another app handed us -- the share sheet, "Open with". Not read on
     * arrival: the event's date and beach come first, and it is offered on the
     * capture screen instead.
     */
    var pendingPdf by mutableStateOf<ScanFile?>(null)

    /** A file another app offered that could not be read, said on screen 3. */
    var importProblem by mutableStateOf<String?>(null)

    /**
     * The system stopped the reader while it held this scan, and the pictures
     * went with it. Said on screens 6 and 7 rather than leaving them waiting
     * for crops that will never come. The typing is in the draft.
     */
    var readerLost by mutableStateOf(false)
        private set

    /**
     * Pages the pipeline refused, worst first. A misregistered page yields
     * ordinary-looking numbers attached to the wrong debris items, so a page
     * that will not line up is surfaced rather than cropped from.
     */
    val refusedPages: List<ScanPage>
        get() = scan?.pages.orEmpty().filter { !it.trusted }.sortedBy { it.bannerOverlap }

    // What has been typed

    private val typed = mutableStateMapOf<CellKey, Int>()
    val values: Map<CellKey, Int> get() = typed

    /**
     * The values that are still there as the tool put them. Kept apart from
     * `values` because the spreadsheet records, per value, whether a human
     * entered it. Touching a box takes its cell out of here.
     */
    private val machine = mutableStateMapOf<CellKey, Prefill>()
    val untouched: Map<CellKey, Prefill> get() = machine

    /** Where the reviewer is, and what is on the keypad. */
    var index by mutableIntStateOf(0)
    var entry by mutableStateOf("")

    // Finishing

    var exportedFile by mutableStateOf<File?>(null)
        private set
    var exportError by mutableStateOf<String?>(null)

    // Drafts

    var offeredDraft by mutableStateOf<Draft?>(null)
        private set

    private val drafts = DraftStore(application)
    val finished = FinishedStore(application)
    private var saveJob: Job? = null
    private var pendingRestore: Draft? = null

    init {
        offeredDraft = drafts.load()
        engine.onRestart = ::readerRestarted

        // Warm the reference card, the cell maps and the digit model while the
        // volunteer is still on the first screen.
        viewModelScope.launch { engine.open() }
    }

    override fun onCleared() {
        engine.destroy()
    }

    // Moving

    /** Back, from the system gesture or a nav bar. Pops one screen. */
    fun back() {
        // Mid-read there is nothing behind the reading screen worth going to:
        // the scan would land on a screen that is no longer showing it. iOS
        // hides the back affordance here for the same reason.
        if (path.lastOrNull() == Screen.Reading && reading) return
        path.removeLastOrNull()
    }

    fun push(screen: Screen) {
        path.add(screen)
    }

    // Starting

    /**
     * Another app handed us a PDF. Copy it, then start a cleanup around it.
     *
     * The copy comes first and the cleanup only if it worked: starting over is
     * safe because the draft is flushed on the way (and comes back on screen 1),
     * but starting over around a file that is not there is not.
     */
    fun openExternal(uri: Uri) {
        viewModelScope.launch {
            val copy = withContext(Dispatchers.IO) { Incoming.copy(app, uri) }
            if (copy == null) {
                importProblem = "That file could not be opened. Try saving it to the phone first, then choose it from here."
                return@launch
            }
            flush()
            startNewCleanup()
            pendingPdf = copy
        }
    }

    fun startNewCleanup() {
        event = EventForm()
        clearScan()
        pendingPdf = null
        importProblem = null
        // Re-read the offer, so screen 1 has whatever `flush` just put on disk.
        // See the note on `startNewCleanup` in TallyModel.swift.
        offeredDraft = drafts.load()
        path.clear()
        path.add(Screen.Event)
    }

    /**
     * Resume the offered draft. Only ever from a tap: nothing is put back
     * unasked. The values come back, but the scan they belong to is not in
     * memory -- the crops were never on disk -- so the same PDF is asked for,
     * and the draft is applied once it matches.
     */
    fun resumeDraft() {
        val draft = offeredDraft ?: return
        event = draft.event
        pendingRestore = draft
        path.clear()
        path.add(Screen.Capture)
    }

    fun discardDraft() {
        drafts.clear()
        offeredDraft = null
        startNewCleanup()
    }

    // Reading a scan

    /** A PDF the picker chose. Copied in first, for the reason in Files.kt. */
    fun readPicked(uri: Uri) {
        viewModelScope.launch {
            val copy = withContext(Dispatchers.IO) { Incoming.copy(app, uri) }
            if (copy == null) {
                importProblem = "That file could not be opened. Try saving it to the phone first, then choose it again."
                return@launch
            }
            read(copy)
        }
    }

    /** The pages the document scanner captured, bound into a PDF and read. */
    fun readCaptured(pages: List<Uri>) {
        viewModelScope.launch {
            val pdf = try {
                withContext(Dispatchers.IO) { CapturedPages.pdf(app, pages) }
            } catch (e: Exception) {
                importProblem = "Those pictures could not be prepared: ${e.message}"
                return@launch
            }
            read(pdf)
        }
    }

    fun read(pdf: ScanFile) {
        viewModelScope.launch { readNow(pdf) }
    }

    private suspend fun readNow(pdf: ScanFile) {
        readingError = null
        importProblem = null
        clearScan(resetEngine = false)
        reading = true
        path.add(Screen.Reading)

        try {
            // Awaited rather than fired: the previous scan's crops are let go
            // before this one's arrive, never after.
            engine.reset()
            val result = engine.process(pdf.file, pdf.name)
            scan = result
            allCells = result.cards.flatMap { card ->
                card.cells.map { FlatCell(CellKey(card.cardNumber, it.row), card.column, it) }
            }
            cells = allCells.filter { it.cell.prefill?.takenAsRead != true }

            // Seed the date and beach from the filename where it follows the
            // chapter's convention. Shown for confirmation, never used
            // silently, and never over something already typed.
            result.seeded?.let { seeded ->
                if (event.date.isEmpty()) event = event.copy(date = seeded.date)
                if (event.shoreline.isEmpty()) event = event.copy(shoreline = seeded.shoreline)
            }

            seedPrefills()
            applyPendingRestoreIfItMatches()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            readingError = e.message ?: "The reader failed without saying why."
        } finally {
            reading = false
        }
    }

    /**
     * Put the tool's own readings in, wherever it has one. Over `allCells`
     * rather than `cells`: the readings the tool is surest of are exactly the
     * ones with no screen behind them. See `seedPrefills` in TallyModel.swift.
     */
    private fun seedPrefills() {
        for (flat in allCells) {
            val prefill = flat.cell.prefill ?: continue
            typed[flat.key] = prefill.value
            machine[flat.key] = prefill
        }
    }

    /**
     * A draft is only ever applied to the scan it was taken from. Same rule as
     * `draftMatches` in src/lib/draft.ts.
     */
    private fun applyPendingRestoreIfItMatches() {
        val draft = pendingRestore ?: return
        val scan = scan ?: return
        pendingRestore = null
        if (!draft.matches(scan)) return

        typed.clear()
        typed.putAll(draft.cells)
        // A restored draft is a person's work. Nothing in it is claimed as a
        // machine reading...
        machine.clear()
        // ...except the ones they were never shown, and only where the saved
        // value still matches what the tool read.
        for (flat in allCells) {
            val prefill = flat.cell.prefill ?: continue
            if (!prefill.takenAsRead) continue
            if (typed[flat.key] != prefill.value) continue
            machine[flat.key] = prefill
        }
    }

    private fun clearScan(resetEngine: Boolean = true) {
        scan = null
        allCells = emptyList()
        cells = emptyList()
        typed.clear()
        machine.clear()
        index = 0
        entry = ""
        exportedFile = null
        exportError = null
        readerLost = false
        crops.clear()
        if (resetEngine) viewModelScope.launch { engine.reset() }
    }

    private fun readerRestarted() {
        if (scan == null) return
        flush()
        crops.clear()
        readerLost = true
    }

    // Checking

    val current: FlatCell? get() = cells.getOrNull(index)

    val checkedCount: Int get() = typed.size

    /** Load the keypad with whatever this cell already holds. */
    fun syncEntryToCurrentCell() {
        val current = current ?: run { entry = ""; return }
        entry = typed[current.key]?.toString() ?: ""
    }

    /** Start the review at the first cell. */
    fun startChecking() {
        index = 0
        syncEntryToCurrentCell()
        push(Screen.Review)
    }

    fun press(key: String) {
        val current = current ?: return

        // A box the tool filled is REPLACED by the first digit, not appended
        // to: appending to a pre-filled 14 gives 143. See `press` in
        // TallyModel.swift.
        val replacingMachineReading = machine.containsKey(current.key)

        entry = when (key) {
            "C" -> ""
            "<" -> if (replacingMachineReading) "" else entry.dropLast(1)
            else -> ((if (replacingMachineReading) "" else entry) + key).take(4)
        }

        // The moment a person touches the keypad this box is theirs.
        machine.remove(current.key)
    }

    /** Write the value and move on. `0` from "Nothing there" records a true zero. */
    fun commit(value: Int?) {
        val current = current ?: return
        if (value != null) {
            typed[current.key] = value
            machine.remove(current.key)
        } else {
            entry.toIntOrNull()?.let { typed[current.key] = it }
        }
        scheduleSave()

        entry = ""
        if (index + 1 >= cells.size) {
            push(Screen.Cards)
        } else {
            index += 1
            syncEntryToCurrentCell()
        }
    }

    fun jump(key: CellKey) {
        val at = cells.indexOfFirst { it.key == key }
        if (at < 0) return
        index = at
        syncEntryToCurrentCell()
        push(Screen.Review)
    }

    // Persistence

    /**
     * Write the draft at most a few times a second: 400ms, matching
     * `scheduleSave` on the web side. `flush` closes the gap when the app goes
     * to the background.
     */
    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(400)
            val draft = currentDraft() ?: return@launch
            withContext(Dispatchers.IO) { drafts.save(draft) }
        }
    }

    /**
     * Write the draft now, on this thread. The callers are the app going to the
     * background and a cleanup being replaced -- the moments a write must not
     * be left in the air.
     */
    fun flush() {
        currentDraft()?.let { drafts.save(it) }
    }

    private fun currentDraft(): Draft? {
        val scan = scan ?: return null
        if (typed.isEmpty()) return null
        return Draft.of(scan, event, typed.toMap())
    }

    // Export

    /** The gate: warnings, not walls. You can send it anyway -- you are the one who saw the paper. */
    data class GateItem(val tone: Tone, val text: String) {
        enum class Tone { Pass, Warning, PrivacyNote }

        val icon: ImageVector
            get() = when (tone) {
                Tone.Pass -> Nocturne.Icon.pass
                Tone.Warning -> Nocturne.Icon.warning
                Tone.PrivacyNote -> Nocturne.Icon.privacy
            }

        val color: Color
            get() = when (tone) {
                Tone.Pass, Tone.PrivacyNote -> Nocturne.accent
                Tone.Warning -> Nocturne.accent400
            }
    }

    /** Mirrors `checkExportGate` in src/lib/schema.ts, in the volunteer's words. */
    val gateItems: List<GateItem>
        get() {
            val items = mutableListOf<GateItem>()
            val cardCount = scan?.cards?.size ?: 0

            val stated = event.volunteers.toIntOrNull()
            if (stated != null && stated != cardCount) {
                items += GateItem(
                    GateItem.Tone.Warning,
                    "The leader's card says $stated volunteers, but $cardCount card${if (cardCount == 1) " was" else "s were"} scanned. Worth a look — it is usually a card that never made it into the pile.",
                )
            } else {
                val all = allCells.size
                items += GateItem(
                    GateItem.Tone.Pass,
                    "$cardCount card${if (cardCount == 1) "" else "s"}, $all cell${if (all == 1) "" else "s"}, $checkedCount filled in" +
                        if (takenAsReadCount > 0) " — $takenAsReadCount read confidently and never shown." else ".",
                )
            }

            val pounds = event.pounds.toDoubleOrNull()
            items += if (pounds != null && pounds > 0) {
                GateItem(GateItem.Tone.Pass, "${event.pounds} lb of trash recorded.")
            } else {
                GateItem(GateItem.Tone.Warning, "Pounds of trash is blank. The sheet still works without it.")
            }

            for (page in refusedPages) {
                items += GateItem(
                    GateItem.Tone.Warning,
                    "Page ${page.pageNumber} never lined up and was left out. The ${page.side} rows of that card will be empty.",
                )
            }

            // How much of this the tool typed rather than they did.
            if (machine.isNotEmpty()) {
                val n = machine.size
                items += GateItem(
                    GateItem.Tone.Warning,
                    "$n value${if (n == 1) " was" else "s were"} filled in by the tool and not checked. They go to the spreadsheet marked as machine-read.",
                )
            }

            items += GateItem(GateItem.Tone.PrivacyNote, "The scan stays on this phone. Only the spreadsheet leaves.")
            return items
        }

    val exportName: String
        get() {
            val slug = event.shoreline.trim().replace(" ", "-")
            return "${event.date}_${slug.ifEmpty { "Cleanup" }}.xlsx"
        }

    suspend fun makeSpreadsheet() {
        exportError = null

        val byCard = typed.entries.groupBy({ it.key.card }, { it.key.row to it.value })
        val input = buildJsonObject {
            putJsonObject("event") {
                put("date", event.date)
                put("shoreline", event.shoreline.trim())
                put("volunteers", event.volunteers.toIntOrNull())
                put("pounds", event.pounds.toDoubleOrNull())
                put("durationHours", event.durationHours.toDoubleOrNull())
                put("dataEntryVolunteer", event.dataEntryVolunteer.ifEmpty { null })
                put("club", event.club.ifEmpty { null })
            }
            putJsonArray("values") {
                for ((card, rows) in byCard) {
                    addJsonArray {
                        add(card)
                        addJsonArray {
                            for ((row, value) in rows.sortedBy { it.first }) {
                                addJsonArray {
                                    add(row)
                                    add(value)
                                }
                            }
                        }
                    }
                }
            }
            putJsonArray("prefilled") {
                for (key in machine.keys) {
                    addJsonArray {
                        add(key.card)
                        add(key.row)
                    }
                }
            }
            putJsonArray("confidences") {
                for ((key, prefill) in machine) {
                    addJsonArray {
                        add(key.card)
                        add(key.row)
                        add(prefill.confidence)
                    }
                }
            }
        }

        try {
            val result = engine.export(input)
            val file = withContext(Dispatchers.IO) {
                val bytes = Base64.decode(result.base64, Base64.DEFAULT)
                if (bytes.isEmpty()) throw EngineException("the workbook came back empty")
                Spreadsheet.write(app, result.filename, bytes)
            }

            exportedFile = file
            finished.record(beach = event.shoreline, date = event.date, cards = scan?.cards?.size ?: 0)
            drafts.clear()
            offeredDraft = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            exportError = e.message ?: "The spreadsheet could not be made."
        }
    }

    fun backToCleanups() {
        clearScan()
        event = EventForm()
        pendingPdf = null
        path.clear()
        offeredDraft = drafts.load()
    }
}
