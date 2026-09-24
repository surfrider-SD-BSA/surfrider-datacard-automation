//
//  What survives the app being closed.
//
//  Stores.swift, for Android. Two files, both JSON, both in the app's private
//  files directory, and neither leaving the device -- the manifest turns off
//  backup and device transfer for exactly these two. The scan itself is never
//  written down: the crops are pictures of volunteer handwriting, and the
//  promise on every screen is that they stay in memory and go when the app
//  does. What is kept is what somebody typed.
//

package com.mateobesse.surfriderdatacards.tally

import android.content.Context
import android.util.AtomicFile
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

/** One cell of one card. Card number and taxonomy row, stable for a given PDF. */
data class CellKey(val card: Int, val row: Int) {
    /** "3:41". Readable in the file, because the file is the only copy of somebody's afternoon. */
    val encoded: String get() = "$card:$row"

    companion object {
        fun decode(text: String): CellKey? {
            val parts = text.split(":")
            if (parts.size != 2) return null
            val card = parts[0].toIntOrNull() ?: return null
            val row = parts[1].toIntOrNull() ?: return null
            return CellKey(card, row)
        }
    }
}

@Serializable
data class EventForm(
    /**
     * Today, not the empty string. See the note on `EventForm.date` in
     * TallyModel.swift: a date field that shows today while the model holds
     * nothing leaves "Scan the cards" disabled for no visible reason. A control
     * must not display a value the model does not have.
     */
    val date: String = LocalDate.now().toString(),
    val shoreline: String = "",
    val volunteers: String = "",
    val pounds: String = "",
    /** Off-screen defaults, per the handoff. Both editable, neither asked for. */
    val durationHours: String = "2",
    val dataEntryVolunteer: String = "",
    val club: String = "Surfrider San Diego (CH54)",
) {
    /** Only the date and the beach are needed to finish. */
    val isComplete: Boolean get() = date.isNotEmpty() && shoreline.isNotBlank()
}

// The draft

/**
 * Typing up a 58-card event is hundreds of numbers read off hundreds of
 * pictures, and the person doing it is a volunteer doing it for free.
 *
 * Three things this deliberately does NOT do, carried over from
 * src/lib/draft.ts by way of Stores.swift: it does not restore anything on its
 * own; it does not offer a draft for a different scan; it does not leave the
 * device.
 */
@Serializable
data class Draft(
    val fileName: String,
    val fileSize: Long,
    val cardCount: Int,
    val cellCount: Int,
    /** ISO-8601 instant. */
    val savedAt: String,
    val event: EventForm,
    /** "card:row" -> value. */
    val values: Map<String, Int>,
) {
    val cells: Map<CellKey, Int>
        get() = values.mapNotNull { (key, value) -> CellKey.decode(key)?.let { it to value } }.toMap()

    /** Is this draft for the scan now in memory? Same rule as `draftMatches` in src/lib/draft.ts. */
    fun matches(scan: ScanResult): Boolean =
        fileName == scan.fileName &&
            fileSize == scan.fileSize &&
            cardCount == scan.cards.size &&
            cellCount == scan.cards.sumOf { it.cells.size }

    /** "3 minutes ago", for a line somebody has to make a decision from. */
    val age: String
        get() {
            val saved = try {
                Instant.parse(savedAt)
            } catch (e: DateTimeParseException) {
                return "a while ago"
            }
            val seconds = max(0L, Duration.between(saved, Instant.now()).seconds)
            if (seconds < 90) return "just now"
            val minutes = (seconds / 60.0).roundToInt()
            if (minutes < 60) return "$minutes minutes ago"
            val hours = (minutes / 60.0).roundToInt()
            if (hours < 24) return "$hours hour${if (hours == 1) "" else "s"} ago"
            val days = (hours / 24.0).roundToInt()
            return "$days day${if (days == 1) "" else "s"} ago"
        }

    companion object {
        fun of(scan: ScanResult, event: EventForm, values: Map<CellKey, Int>) = Draft(
            fileName = scan.fileName,
            fileSize = scan.fileSize,
            cardCount = scan.cards.size,
            cellCount = scan.cards.sumOf { it.cells.size },
            savedAt = Instant.now().toString(),
            event = event,
            values = values.mapKeys { it.key.encoded },
        )
    }
}

class DraftStore(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "draft.json"))

    /**
     * Losing the draft is bad; taking the app down while somebody is typing is
     * worse. A write that fails is a write that failed.
     *
     * Synchronized because two writers exist -- the debounced save off the main
     * thread, and `flush` on it as the app goes to the background -- and an
     * AtomicFile is atomic against a crash, not against itself.
     */
    @Synchronized
    fun save(draft: Draft) {
        val stream = try {
            file.startWrite()
        } catch (e: IOException) {
            return
        }
        try {
            stream.write(TallyJson.encodeToString(Draft.serializer(), draft).toByteArray())
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
        }
    }

    @Synchronized
    fun load(): Draft? = try {
        TallyJson.decodeFromString(Draft.serializer(), String(file.readFully()))
    } catch (e: Exception) {
        null
    }

    @Synchronized
    fun clear() {
        file.delete()
    }
}

// Finished cleanups

/** "21 Feb" */
private val shortDay: DateTimeFormatter get() = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())

/**
 * A line per event that was actually exported: what it was, when, and how many
 * cards. No values and no pictures -- a record that the work was done, not a
 * second copy of it.
 */
@Serializable
data class FinishedEvent(
    val id: String = UUID.randomUUID().toString(),
    val beach: String,
    /** ISO, as typed on screen 2. */
    val date: String,
    val cards: Int,
    val exportedAt: String,
) {
    /** "21 Feb · 58 cards · sent" */
    val meta: String
        get() {
            val parts = mutableListOf<String>()
            val day = try {
                LocalDate.parse(date)
            } catch (e: DateTimeParseException) {
                null
            }
            when {
                day != null -> parts += day.format(shortDay)
                date.isNotEmpty() -> parts += date
            }
            parts += "$cards card${if (cards == 1) "" else "s"}"
            parts += "sent"
            return parts.joinToString(" · ")
        }
}

class FinishedStore(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "finished.json"))

    var events by mutableStateOf(load())
        private set

    fun record(beach: String, date: String, cards: Int) {
        val event = FinishedEvent(beach = beach.trim(), date = date, cards = cards, exportedAt = Instant.now().toString())
        // Ten is what fits on the screen without becoming an archive nobody
        // asked this app to keep.
        events = (listOf(event) + events).take(10)

        val stream = try {
            file.startWrite()
        } catch (e: IOException) {
            return
        }
        try {
            stream.write(TallyJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(FinishedEvent.serializer()), events).toByteArray())
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
        }
    }

    private fun load(): List<FinishedEvent> = try {
        TallyJson.decodeFromString(
            kotlinx.serialization.builtins.ListSerializer(FinishedEvent.serializer()),
            String(file.readFully()),
        )
    } catch (e: Exception) {
        emptyList()
    }
}

/** "21 Feb", for the draft card's title. Null if the date will not parse. */
fun shortDate(iso: String): String? = try {
    LocalDate.parse(iso).format(shortDay)
} catch (e: DateTimeParseException) {
    null
}
