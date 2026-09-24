//
//  6 — Checking a number  ← the screen that matters
//
//  Read one cell picture, type one number. This is where the hours go, and it
//  is the whole reason the phone is worth building for: one cell at a time on a
//  thumb-sized keypad, instead of hunting a 453-row list with a trackpad.
//
//  THE CROP STAYS ON WHITE. It is a photograph of paper and the job is reading
//  faint pencil; inverting or dimming it costs contrast exactly where it is
//  scarcest. Same note as the top of src/style.css and ReviewScreen.swift, and
//  it is not a theming oversight.
//
//  THE BOX MAY ARRIVE FILLED. The tool reads what it can and puts it in, and a
//  real share of filled boxes are wrong. That is defensible only because the
//  box is tagged as a claim and sits directly under a picture of the
//  handwriting -- so the tag is not decoration, and neither is the order.
//
//  ANDROID LAYOUT. iOS lays this out for one tall phone. Android phones run
//  much shorter, so everything above the keypad scrolls, and the keypad and its
//  two buttons stay where a thumb expects them.
//

package com.mateobesse.surfriderdatacards.tally.screens

import android.content.Context
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mateobesse.surfriderdatacards.tally.ButtonIcon
import com.mateobesse.surfriderdatacards.tally.ChromeButton
import com.mateobesse.surfriderdatacards.tally.CropCache
import com.mateobesse.surfriderdatacards.tally.FlatCell
import com.mateobesse.surfriderdatacards.tally.Haptics
import com.mateobesse.surfriderdatacards.tally.NavBar
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.ProgressLine
import com.mateobesse.surfriderdatacards.tally.Screen
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.SecondaryButton
import com.mateobesse.surfriderdatacards.tally.Tag
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.TextAction
import com.mateobesse.surfriderdatacards.tally.TintedPanel
import com.mateobesse.surfriderdatacards.tally.pageMargin
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first

private const val PREFS = "tally"
private const val SHOW_WHOLE_ROW = "showWholeRow"

@Composable
fun ReviewScreen(model: TallyModel) {
    val context = LocalContext.current

    /**
     * Show the whole row as a strip beneath the box. On by default, and
     * remembered, as @AppStorage does on iOS. The row is what tells you the
     * ink in this box belongs to THIS item and not the one above it -- the
     * mistake a reviewer cannot otherwise catch. See the long note on
     * `showWholeRow` in ReviewScreen.swift for why it is added beneath the box
     * rather than replacing it.
     */
    var showWholeRow by remember {
        mutableStateOf(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(SHOW_WHOLE_ROW, true))
    }
    fun toggleRow() {
        showWholeRow = !showWholeRow
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(SHOW_WHOLE_ROW, showWholeRow).apply()
    }

    val flat = model.current

    // The pictures are read from the cache in composition, keyed by the cell
    // being drawn, and never held in this screen's state: three pictures left
    // over from the previous cell would otherwise show under the next cell's
    // name for a frame, at the rate this screen is worked. The cache is
    // snapshot state, so a crop landing redraws this screen by itself.
    if (flat != null) {
        LaunchedEffect(flat.key, showWholeRow) {
            coroutineScope {
                // Three pictures of one cell have nothing to do with each
                // other; awaiting them one after another costs the sum of three
                // round trips to show the first.
                val total = async { model.crops.image(key(flat, "total")) }
                val context = async { model.crops.image(key(flat, "context"), showWholeRow) }
                val marks = async { model.crops.image(key(flat, "marks"), flat.cell.tallyOnly) }
                total.await(); context.await(); marks.await()
            }
            // Somebody who taps faster than the engine answers has already moved on.
            if (model.current?.key != flat.key) return@LaunchedEffect
            // The cells they are about to reach, while they are still reading
            // this one. This is what makes "Next" paint in the frame it lands.
            model.crops.prefetch(cropsAhead(model, showWholeRow))
        }
    }

    ScreenBody {
        NavBar(back = "Back", onBack = model::back) {
            ChromeButton(onClick = { model.push(Screen.Cards) }, size = 15) { Text("All cards") }
        }

        if (flat == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("Nothing to check on this scan.", style = Nocturne.Face.body(14), color = Nocturne.text(55))
            }
            return@ScreenBody
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            ProgressBlock(model, flat)
            ItemBlock(model, flat)
            if (model.readerLost) {
                ReaderLost(model)
            } else {
                CropBlock(model, flat, showWholeRow, ::toggleRow)
                if (flat.cell.tallyOnly) TallyPanel(model, flat)
            }
            Spacer(Modifier.height(8.dp))
        }

        EntryDisplay(model)
        Keypad(model)
        Footer(model)
    }
}

// Blocks

@Composable
private fun ProgressBlock(model: TallyModel, flat: FlatCell) {
    Column(Modifier.pageMargin().padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row {
            Text("Cell ${model.index + 1} of ${model.cells.size}", style = Nocturne.Face.label(12), color = Nocturne.text(52))
            Spacer(Modifier.weight(1f))
            Text("Card ${flat.key.card} → column ${flat.column}", style = Nocturne.Face.label(12), color = Nocturne.text(52))
        }
        ProgressLine(
            fraction = if (model.cells.isEmpty()) 0f else (model.index + 1).toFloat() / model.cells.size,
            height = 4.dp,
        )
    }
}

@Composable
private fun ItemBlock(model: TallyModel, flat: FlatCell) {
    Column(
        Modifier.fillMaxWidth().pageMargin().padding(top = 22.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        // The names run long -- "Plastic Food Wrappers (candy, chip bags)" --
        // so they wrap rather than truncate.
        Text(flat.cell.itemName, style = Nocturne.Face.item, color = Nocturne.text)

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(flat.cell.section, style = Nocturne.Face.label(12), color = Nocturne.accent300)
            // Which reader spoke, if one did. The reviewer is entitled to know
            // which claim they are being asked to check.
            model.untouched[flat.key]?.let { Tag(it.tag) }
        }
    }
}

@Composable
private fun CropBlock(model: TallyModel, flat: FlatCell, showWholeRow: Boolean, toggle: () -> Unit) {
    val totalKey = key(flat, "total")
    val contextKey = key(flat, "context")

    Column(Modifier.pageMargin().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        // The TOTAL box, enlarged. This is the picture the number is read from
        // and it is never traded for anything else.
        Paper(height = 118) {
            val crop = model.crops.cached(totalKey)
            when {
                crop != null -> Image(
                    bitmap = crop,
                    contentDescription = "The handwriting in the TOTAL box for ${flat.cell.itemName}",
                    contentScale = ContentScale.Fit,
                    filterQuality = FilterQuality.High,
                    modifier = Modifier.fillMaxSize().padding(6.dp),
                )
                model.crops.failed(totalKey) -> NoPicture()
                else -> Waiting()
            }
        }

        // The row it sits in, as a strip. Context for whether this ink belongs
        // to THIS item, without costing the box any size.
        val row = model.crops.cached(contextKey)
        if (showWholeRow && row != null) {
            Paper(height = 42) { RowStrip(flat, row) }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (showWholeRow) "The TOTAL box at 2.4×, over its row — swipe it" else "The TOTAL box, enlarged 2.4×",
                style = Nocturne.Face.label(11),
                color = Nocturne.text(40),
                modifier = Modifier.weight(1f),
            )
            TextAction(if (showWholeRow) "Hide the row" else "Show the whole row", onClick = toggle, size = 11)
        }
    }
}

/**
 * The row, scrolled sideways and parked on the TOTAL box at its right-hand end.
 *
 * The width is computed from the picture's own proportions rather than left to
 * the layout. The iOS app shipped this strip once as an empty white card,
 * because an image that fits itself inside a sideways scroller is offered
 * unlimited width and resolves to nothing; the same trap exists here.
 */
@Composable
private fun RowStrip(flat: FlatCell, row: ImageBitmap) {
    val scroll = rememberScrollState()
    val width = if (row.height > 0) (34f * row.width / row.height).dp else 0.dp

    LaunchedEffect(flat.key, row) {
        snapshotFlow { scroll.maxValue }.first { it > 0 && it != Int.MAX_VALUE }
        scroll.scrollTo(scroll.maxValue)
    }

    Row(Modifier.fillMaxSize().horizontalScroll(scroll).padding(vertical = 4.dp)) {
        Image(
            bitmap = row,
            contentDescription = "The whole row for ${flat.cell.itemName}",
            contentScale = ContentScale.FillBounds,
            filterQuality = FilterQuality.High,
            modifier = Modifier.width(width).height(34.dp),
        )
    }
}

/**
 * A tally-only cell has no number to read. What the reviewer has to do is count
 * the marks, so the marks are shown at the size they were drawn.
 */
@Composable
private fun TallyPanel(model: TallyModel, flat: FlatCell) {
    TintedPanel(Modifier.pageMargin().padding(top = 12.dp)) {
        Column(Modifier.padding(vertical = 11.dp, horizontal = 13.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("Tally marks, no total written. Count them.", style = Nocturne.Face.label(12), color = Nocturne.accent300)
            Box(
                Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(5.dp)).background(Nocturne.Paper.fill),
                contentAlignment = Alignment.Center,
            ) {
                model.crops.cached(key(flat, "marks"))?.let {
                    Image(
                        bitmap = it,
                        contentDescription = "The tally marks for ${flat.cell.itemName}",
                        contentScale = ContentScale.Fit,
                        filterQuality = FilterQuality.High,
                        modifier = Modifier.fillMaxSize().padding(6.dp),
                    )
                }
            }
        }
    }
}

/**
 * The system stopped the reader while it held this scan -- see `rendererGone`
 * in Engine.kt -- and the pictures went with it. A spinner that never ends is
 * the worst thing to show here, so this says what happened and what is safe.
 */
@Composable
private fun ReaderLost(model: TallyModel) {
    TintedPanel(Modifier.pageMargin().padding(top = 16.dp)) {
        Column(Modifier.padding(vertical = 14.dp, horizontal = 15.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("The pictures are gone", style = Nocturne.Face.label(15, FontWeight.Medium), color = Nocturne.text)
            Text(
                "The phone stopped the reader, usually because it ran short of memory, and the cell pictures went with it. Everything you typed is saved. Go back to Cleanups, pick up where you left off, and choose the same scan again.",
                style = Nocturne.Face.body(13),
                color = Nocturne.text(68),
            )
            PrimaryButton(onClick = model::backToCleanups, minHeight = Nocturne.minTap, size = 14) { Text("Back to cleanups") }
        }
    }
}

/** Scanned crops sit on white. See the note at the top of this file. */
@Composable
private fun Paper(height: Int, content: @Composable BoxScope.() -> Unit) {
    val shape = RoundedCornerShape(Nocturne.Radius.base)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(height.dp)
            .clip(shape)
            .background(Nocturne.Paper.fill)
            .border(1.dp, Nocturne.Paper.border, shape),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

@Composable
private fun Waiting() {
    CircularProgressIndicator(color = Nocturne.Paper.border, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
}

@Composable
private fun NoPicture() {
    Text("No picture for this cell.", style = Nocturne.Face.label(12), color = Nocturne.Paper.ink)
}

// The keypad

/**
 * The number, on its own line above the keys, the way a calculator's display
 * sits. Not a text field: see the note at the top of TallyModel.kt about why
 * nothing in this path is one.
 */
@Composable
private fun EntryDisplay(model: TallyModel) {
    Box(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 62.dp).padding(horizontal = 16.dp).padding(bottom = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            model.entry.ifEmpty { "—" },
            style = Nocturne.Face.numeral(40),
            color = if (model.entry.isEmpty()) Nocturne.text(45) else Nocturne.text,
        )
    }
}

private val KEYS = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("C", "0", "<"))

@Composable
private fun Keypad(model: TallyModel) {
    val view = LocalView.current
    Column(Modifier.padding(horizontal = 16.dp).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (row in KEYS) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (key in row) {
                    Key(key, Modifier.weight(1f)) {
                        // Before the model, not after: the felt half of the tap
                        // is the half that must not wait on anything.
                        Haptics.tap(view)
                        model.press(key)
                    }
                }
            }
        }
    }
}

/**
 * 54dp, and the pressed state tints from the accent ramp rather than rippling.
 * `C` and backspace are drawn in accent300: a keypad worked for an hour is
 * easier to hit blind when the two keys you reach for by mistake are not the
 * same colour as the ten you want.
 */
@Composable
private fun Key(key: String, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.94f else 1f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium),
        label = "key",
    )
    val clearing = key == "C" || key == "<"
    val shape = RoundedCornerShape(Nocturne.Radius.key)
    val ink = if (clearing) Nocturne.accent300 else Nocturne.text

    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 54.dp)
            .scale(scale)
            .clip(shape)
            .background(if (pressed) Nocturne.accent.copy(alpha = 0.22f) else Nocturne.surface)
            .border(1.dp, if (pressed) Nocturne.accent else Nocturne.divider, shape)
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (key == "<") {
            Icon(Nocturne.Icon.backspace, contentDescription = "Delete", tint = ink, modifier = Modifier.size(22.dp))
        } else {
            Text(
                key,
                style = Nocturne.Face.label(23, FontWeight.Medium),
                color = ink,
            )
        }
    }
}

@Composable
private fun Footer(model: TallyModel) {
    val view = LocalView.current
    Row(
        Modifier
            .padding(horizontal = 16.dp)
            .padding(top = 12.dp)
            .navigationBarsPadding()
            .padding(bottom = Nocturne.aboveNavBar),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // A true zero. Blank is normal -- volunteers are unpaid and leave things
        // blank -- but a zero somebody looked at and a box nobody reached are
        // not the same fact.
        SecondaryButton(
            onClick = {
                Haptics.advance(view)
                model.commit(0)
            },
            modifier = Modifier.weight(1f),
        ) { Text("Nothing there") }

        PrimaryButton(
            onClick = {
                Haptics.advance(view)
                model.commit(model.entry.toIntOrNull())
            },
            modifier = Modifier.weight(1f),
            minHeight = 50.dp,
            enabled = model.entry.isNotEmpty(),
        ) {
            Text(if (model.index + 1 >= model.cells.size) "Done" else "Next")
            ButtonIcon(Nocturne.Icon.next)
        }
    }
}

// -

private fun key(flat: FlatCell, kind: String) = CropCache.Key(flat.key.card, flat.key.row, kind)

/**
 * Three cells ahead: enough to stay in front of somebody typing quickly, and
 * short enough not to encode a whole event's crops for a list that is usually
 * left half done.
 */
private fun cropsAhead(model: TallyModel, showWholeRow: Boolean): List<CropCache.Key> {
    val keys = mutableListOf<CropCache.Key>()
    for (offset in 1..3) {
        val flat = model.cells.getOrNull(model.index + offset) ?: break
        keys += key(flat, "total")
        if (showWholeRow) keys += key(flat, "context")
        if (flat.cell.tallyOnly) keys += key(flat, "marks")
    }
    return keys
}
