//
//  7 — Everything typed
//
//  See the whole event, jump back to any picture.
//
//  A row's value is an em-dash until somebody puts something there, and "0" is
//  a different thing from an em-dash: blank is a real answer and goes to the
//  spreadsheet as nothing, not as zero.
//
//  CardsScreen.swift, for Android. Two things on the Swift screen have no
//  counterpart here and are left out rather than imitated. `softScrollEdges()`
//  is the edge iOS 26 draws where a list passes under a floating bar; this is
//  the flat path, where the ground fade in `WithPinnedActions` does that job,
//  as it does on iOS below 26. And the count in the subtitle rolls its digits
//  on iOS when it changes -- but nothing on this screen changes it. Values are
//  typed on screen 6, and by the time this screen is back on top it has been
//  composed afresh (see `KeptPlace` below), so the number is simply right.
//

package com.mateobesse.surfriderdatacards.tally.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mateobesse.surfriderdatacards.tally.ChromeButton
import com.mateobesse.surfriderdatacards.tally.FlatCell
import com.mateobesse.surfriderdatacards.tally.NavBar
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.RowButton
import com.mateobesse.surfriderdatacards.tally.Screen
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.WithPinnedActions
import com.mateobesse.surfriderdatacards.tally.pageMargin

@Composable
fun CardsScreen(model: TallyModel) {
    // Where in the stack this screen sits, fixed at the moment it was pushed.
    // Two Cards screens can be in the stack at once -- tap a row, check through
    // to the last cell, and `commit` pushes a second one -- and each keeps its
    // own place, as each iOS view would.
    val depth = remember { model.path.size }
    val place = remember { kept[depth]?.takeIf { it.cells === model.cells } }
    val list = rememberLazyListState(
        initialFirstVisibleItemIndex = place?.index ?: 0,
        initialFirstVisibleItemScrollOffset = place?.offset ?: 0,
    )

    DisposableEffect(Unit) {
        onDispose {
            // Disposed because something was pushed over it (the reviewer, or
            // Finish), or because it was popped. Only the first is coming back.
            // By now the stack has already moved, so what sits at this screen's
            // depth says which it was.
            val covered = model.path.size > depth && model.path.getOrNull(depth - 1) == Screen.Cards
            if (covered) {
                kept[depth] = KeptPlace(model.cells, list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset)
            } else {
                kept.keys.removeAll { it >= depth }
            }
        }
    }

    ScreenBody {
        NavBar(back = "Checking", onBack = { model.back() }) {
            ChromeButton(onClick = { model.push(Screen.Finish) }, size = 15) {
                Text("Finish")
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .pageMargin()
                .padding(top = 6.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                if (model.event.shoreline.isEmpty()) "This cleanup" else model.event.shoreline,
                style = Nocturne.Face.title(26),
                color = Nocturne.text,
            )
            Text(
                "${model.checkedCount} of ${model.allCells.size} filled in · tap a row to look at the picture again",
                style = Nocturne.Face.body(13),
                color = Nocturne.text(55),
            )
        }

        WithPinnedActions(
            actions = {
                PrimaryButton(onClick = { model.push(Screen.Finish) }) {
                    Text("Make the spreadsheet")
                }
            },
        ) { clearance ->
            // Lazy because this is every cell the tool did not take as read,
            // across every card in the pile -- a few hundred rows on a big
            // cleanup, each reading two snapshot maps. Keyed on the cell, so a
            // row that is recomposed is the same item, not whatever now sits at
            // its index. The clearance is the pinned button's height, left clear
            // at the end of the scroll exactly as `.safeAreaInset` leaves it on
            // iOS, so the note can be scrolled out from under the button.
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = clearance),
            ) {
                items(model.cells, key = { it.key.encoded }) { flat ->
                    CardRow(model, flat)
                }

                item(key = "blank-note") {
                    Text(
                        blankNote(model.untouched.size),
                        // SwiftUI's `lineSpacing(2)` adds two points to the
                        // font's own line, which for the system face at 12 is
                        // about 14. Compose sets the whole line, so the sum.
                        style = Nocturne.Face.label(12).copy(lineHeight = 16.sp),
                        color = Nocturne.text(40),
                        modifier = Modifier
                            .fillMaxWidth()
                            .pageMargin()
                            .padding(top = 16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun CardRow(model: TallyModel, flat: FlatCell) {
    RowButton(onClick = { model.jump(flat.key) }) {
        // The padding is inside the button, not on it, so the press tint and
        // the divider RowButton draws run the full width of the screen, as they
        // do on iOS where the row is the button's label.
        Row(
            modifier = Modifier
                .weight(1f)
                .pageMargin()
                .padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "C${flat.key.card}",
                style = Nocturne.Face.cardTag,
                color = Nocturne.text(38),
                modifier = Modifier.width(26.dp),
            )

            // The flexible part of the row is the name, not a spacer. A Compose
            // Row measures its unweighted children first, so an unweighted name
            // long enough to wrap would take the width the value needs; weighted,
            // it gets what is left after the tag and the value, and the value
            // sits at the trailing edge just as SwiftUI's `Spacer` puts it. The
            // fixed 8dp is that Spacer's `minLength`.
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    flat.cell.itemName,
                    style = Nocturne.Face.label(14),
                    color = Nocturne.text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    flat.cell.section,
                    style = Nocturne.Face.label(11),
                    color = Nocturne.text(45),
                )
            }

            Spacer(Modifier.width(8.dp))

            Text(
                model.values[flat.key]?.toString() ?: "—",
                style = Nocturne.Face.numeral(19),
                // A value the tool put there and nobody has looked at is drawn
                // in the accent, exactly as `.cell.prefilled` does on the web
                // side. Scrolling past a few hundred of these, a machine
                // reading that looks like a typed one is how it gets exported
                // as though somebody had read it off the card.
                color = tone(model, flat),
            )
        }
    }
}

private fun tone(model: TallyModel, flat: FlatCell): Color {
    if (model.untouched[flat.key] != null) return Nocturne.accent
    return if (model.values[flat.key] == null) Nocturne.text(45) else Nocturne.text
}

private fun blankNote(untouched: Int): String {
    var text = "Rows left blank on the paper go to the spreadsheet as nothing, not as zero."
    if (untouched > 0) {
        text += " $untouched value${if (untouched == 1) " is" else "s are"} still as the tool read ${if (untouched == 1) "it" else "them"} — those are in accent above."
    }
    return text
}

/**
 * Where a list was left when something was pushed over it.
 *
 * The whole point of this screen is "tap a row to look at the picture again",
 * and then come back. On iOS the navigation stack keeps this view alive under
 * the reviewer, so back lands on the row that was tapped. The Android stack
 * composes only its top screen (TallyApp.kt), so this list is gone by the time
 * the reviewer is showing, and a volunteer two hundred rows down would come
 * back to the top of it. This is the scroll position the iOS view would still
 * have: kept only while the screen is covered, only for the same scan (the
 * identity of `cells`, which a new read replaces), and forgotten the moment the
 * screen is popped -- a Cards screen pushed afresh starts at the top, as a new
 * iOS view does.
 *
 * Keyed by stack depth, and file-level rather than in the model, because it is
 * layout state with no meaning outside this file. It dies with the process,
 * and so does the scan it refers to.
 */
private class KeptPlace(val cells: List<FlatCell>, val index: Int, val offset: Int)

private val kept = mutableMapOf<Int, KeptPlace>()
