//
//  1 — Cleanups (root)
//
//  Resume interrupted work, or start a new cleanup.
//
//  CleanupsScreen.swift, for Android, and nothing on it behaves differently:
//  the offered draft, the record of what was sent, and one way forward. The
//  finished list is read through the model rather than handed in beside it,
//  because here the store lives on the ViewModel and its `events` is already
//  snapshot state -- reading it is what subscribes this screen to it.
//

package com.mateobesse.surfriderdatacards.tally.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mateobesse.surfriderdatacards.tally.BottomClearance
import com.mateobesse.surfriderdatacards.tally.ButtonIcon
import com.mateobesse.surfriderdatacards.tally.Draft
import com.mateobesse.surfriderdatacards.tally.FinishedEvent
import com.mateobesse.surfriderdatacards.tally.Kicker
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.Panel
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.RowButton
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.SecondaryButton
import com.mateobesse.surfriderdatacards.tally.SectionLabel
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.TintedPanel
import com.mateobesse.surfriderdatacards.tally.WithPinnedActions
import com.mateobesse.surfriderdatacards.tally.pageMargin
import com.mateobesse.surfriderdatacards.tally.shortDate

@Composable
fun CleanupsScreen(model: TallyModel) {
    // No nav bar: this is the root, and there is nowhere to go back to. iOS
    // pads 62 from the top of the screen, which is its usual 56 of status-bar
    // clearance and six more. ScreenBody has already applied the status bar's
    // own inset, so the 56 becomes belowStatusBar -- what the design leaves
    // under the bar once the inset is taken -- and the six carries across as
    // it is.
    ScreenBody(topPadding = Nocturne.belowStatusBar + 6.dp) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .pageMargin()
                .padding(bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Kicker(text = model.chapter)
            Text("Cleanups", style = Nocturne.Face.title(30), color = Nocturne.text)
        }

        // The action floats over the list rather than sitting under it, so a
        // long list of finished cleanups scrolls past it instead of stopping
        // short. iOS 26 separates the two with its soft scroll edge; there is
        // no such thing here, so the ground fade in WithPinnedActions does it --
        // the same answer iOS gives below 26.
        WithPinnedActions(
            actions = {
                PrimaryButton(onClick = { model.startNewCleanup() }) {
                    ButtonIcon(Nocturne.Icon.add)
                    Text("Start a cleanup")
                }
            },
        ) { clearance ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState()),
            ) {
                model.offeredDraft?.let { draft ->
                    DraftCard(
                        draft = draft,
                        model = model,
                        modifier = Modifier.pageMargin().padding(top = 8.dp),
                    )
                }

                val events = model.finished.events
                if (events.isNotEmpty()) {
                    SectionLabel(
                        text = "Finished",
                        modifier = Modifier
                            .pageMargin()
                            .padding(top = 26.dp, bottom = 8.dp),
                    )

                    Panel(modifier = Modifier.pageMargin()) {
                        // Keyed by the record's own id, as the ForEach is on
                        // iOS, so a row's identity is the event it shows
                        // rather than the slot it happens to sit in -- a new
                        // export goes in at the top and pushes the rest down.
                        for (event in events) {
                            key(event.id) { EventRow(event) }
                        }
                    }
                }

                BottomClearance(clearance)
            }
        }
    }
}

/**
 * A draft is offered with its age and its count, and the person chooses.
 * Nothing is ever put back unasked -- see `resumeDraft`.
 */
@Composable
private fun DraftCard(draft: Draft, model: TallyModel, modifier: Modifier = Modifier) {
    TintedPanel(modifier = modifier, radius = Nocturne.Radius.draftCard) {
        Column(
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 15.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            // Aligned on the first baseline, so the small "saved" line sits on
            // the title's text rather than floating at the middle of it; and
            // the title takes the width the iOS spacer would, which keeps the
            // age at the trailing edge and lets a long beach name wrap before
            // it squeezes the age.
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    draftTitle(draft),
                    style = Nocturne.Face.label(15, FontWeight.Medium),
                    color = Nocturne.text,
                    modifier = Modifier
                        .weight(1f)
                        .alignByBaseline(),
                )
                Text(
                    "saved ${draft.age}",
                    style = Nocturne.Face.label(11),
                    color = Nocturne.accent300,
                    modifier = Modifier.alignByBaseline(),
                )
            }

            // Face.body carries the handoff's 1.5 line height itself. iOS gets
            // close to it with `lineSpacing(3)`, because a SwiftUI font has no
            // line height to set, so there is nothing to add here.
            Text(
                "${draft.values.size} of ${draft.cellCount} cells checked. Your typing is on this phone — nothing has been put back until you say so.",
                style = Nocturne.Face.body(13),
                color = Nocturne.text(68),
            )

            Row(
                modifier = Modifier.padding(top = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // The affirmative takes whatever width "Start fresh" leaves
                // it. The way out is the width of its own label, so the
                // choice reads as one obvious action and one lesser one.
                PrimaryButton(
                    onClick = { model.resumeDraft() },
                    modifier = Modifier.weight(1f),
                    minHeight = Nocturne.minTap,
                    size = 14,
                ) {
                    Text("Pick up where I left off")
                }
                SecondaryButton(
                    onClick = { model.discardDraft() },
                    minHeight = Nocturne.minTap,
                    size = 14,
                    stretch = false,
                ) {
                    Text("Start fresh")
                }
            }
        }
    }
}

/**
 * "Ocean Beach, 21 Feb" when both are there. The beach is what a volunteer
 * recognises a cleanup by, so without one the card falls back to the file
 * name -- the only other thing that tells this draft apart -- and a date that
 * will not parse is left off rather than shown as a raw ISO string.
 */
private fun draftTitle(draft: Draft): String {
    // Swift trims `.whitespaces` -- the Zs spaces and the tab, not line breaks
    // -- where Kotlin's bare `trim()` would take newlines too. The same set
    // here, so the card falls back to the file name in exactly the cases iOS
    // does.
    val beach = draft.event.shoreline.trim { it == '\t' || it.category == CharCategory.SPACE_SEPARATOR }
    if (beach.isEmpty()) return draft.fileName
    val day = shortDate(draft.event.date) ?: return beach
    return "$beach, $day"
}

@Composable
private fun EventRow(event: FinishedEvent) {
    RowButton(
        onClick = {
            // Nothing to go back to: the values were not kept, only the record
            // that the work was done. Tapping is a no-op rather than a screen
            // that would have to invent what it shows.
        },
    ) {
        // The padding is inside the row rather than on RowButton's modifier,
        // which would put it outside the press tint and the divider -- the
        // row would light up short of its own edges.
        Row(
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 14.dp, horizontal = 15.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    event.beach.ifEmpty { "Cleanup" },
                    style = Nocturne.Face.label(15, FontWeight.Medium),
                    color = Nocturne.text,
                )
                Text(
                    event.meta,
                    style = Nocturne.Face.label(12),
                    color = Nocturne.text(52),
                )
            }
            // iOS sets this caret at 14pt, a point under the nav bar's 15pt
            // back caret. NavBar draws that one at 24dp, so this one is scaled
            // by the same 14/15. The Material glyph sits inside its own padded
            // box, which is why the dp figure is not the point figure.
            Icon(
                Nocturne.Icon.forward,
                contentDescription = null,
                tint = Nocturne.text(40),
                modifier = Modifier.size(22.dp),
            )
        }
    }
}
