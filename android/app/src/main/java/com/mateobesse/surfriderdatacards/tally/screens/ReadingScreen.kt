//
//  4 — Reading the pages
//
//  Honest progress, and the privacy promise where it counts.
//
//  The steps are the real ones. `processFile` on the web side rasterizes,
//  registers, cuts into cells and drops each page before the next is read, and
//  src/engine.ts does the same thing for the same reason -- memory discipline
//  matters more on a phone than it did in the browser. So the bar moves per
//  page, not on a timer.
//
//  ReadingScreen.swift, for Android. The engine is reached through the model
//  rather than handed in beside it, because on Android it lives on the
//  ViewModel and its `progress` is already snapshot state -- reading it here is
//  what subscribes this screen to each page as it lands.
//
//  "Nothing is uploaded" is a stronger sentence here than on iOS: the app holds
//  no INTERNET permission, so the reader's WebView cannot reach the network
//  even if something in it tried. See the note at the top of
//  AndroidManifest.xml.
//
//  There is no nav bar on this screen, as there is none on iOS, where the back
//  button is hidden. Mid-read there is nothing behind it worth going to: the
//  scan would land on a screen that is no longer showing it. Android's system
//  back still arrives, and `TallyModel.back` refuses it while the reader is
//  working. Once the read is over it is let through, back to the capture
//  screen with the event still filled in -- a platform gesture iOS has no
//  equivalent of here, since hiding the back button there also stops the swipe.
//

package com.mateobesse.surfriderdatacards.tally.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.Panel
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.ProgressLine
import com.mateobesse.surfriderdatacards.tally.ScanResult
import com.mateobesse.surfriderdatacards.tally.Screen
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.SecondaryButton
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.pageMargin

@Composable
fun ReadingScreen(model: TallyModel) {
    // iOS pads 110 from the top of the screen: its 56 of status-bar clearance
    // and 54 more. The 54 is roughly the room a nav bar and its gap take on the
    // screens that have one, so with no nav bar here the title still does not
    // start higher than theirs. ScreenBody has already applied the status bar's
    // own inset, so the 54 is what is left to add.
    ScreenBody(topPadding = Nocturne.belowStatusBar + 54.dp) {
        // The one departure in the layout. iOS does not scroll this: its type is
        // fixed-size, so the page is the height the design drew. Android scales
        // `sp` with the system font size, and at the largest settings the steps
        // and the summary together can outgrow a phone -- unscrolled, that
        // squeezes "Start checking" off the bottom, and it is the one thing on
        // the screen that must be reachable. So the upper part takes the place of the Swift's
        // `Spacer(minLength: 0)`: at ordinary sizes it is that spacer, the same
        // content with the same empty ground below it, and only when the page
        // overflows does it scroll, under a footer that stays put.
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .pageMargin(),
        ) {
            Text(
                "Reading the cards",
                style = Nocturne.Face.title(26),
                color = Nocturne.text,
                modifier = Modifier.padding(bottom = 8.dp),
            )

            Text(
                "Nothing is uploaded. This all happens on the phone, and stops if you close the app.",
                style = Nocturne.Face.body(13),
                color = Nocturne.text(60),
                modifier = Modifier.padding(bottom = 26.dp),
            )

            ProgressLine(fraction = fraction(model))

            Text(
                caption(model),
                style = Nocturne.Face.body(13),
                color = Nocturne.text(62),
                modifier = Modifier.padding(top = 10.dp),
            )

            // The flat outlined panel, which is what iOS draws below 26; there
            // is no glass here to put it in instead.
            Panel(modifier = Modifier.padding(top = 28.dp)) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    for (step in steps(model)) {
                        key(step.label) {
                            StepRow(step)
                        }
                    }
                }
            }
        }

        // The foot of the screen: the way out if the read failed, the way on if
        // it worked, and nothing while it is still going. It clears the
        // navigation bar itself, since there are no pinned actions here to do
        // it -- the same room iOS leaves for its home indicator. The clearance
        // is kept even while the footer is empty, which costs nothing visible
        // and keeps an overflowing page from scrolling under the gesture bar.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(bottom = Nocturne.aboveNavBar)
                .pageMargin(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val error = model.readingError
            val scan = model.scan
            if (error != null) {
                Text(
                    "That scan could not be read.",
                    style = Nocturne.Face.label(15, FontWeight.Medium),
                    color = Nocturne.text,
                )
                Text(
                    error,
                    style = Nocturne.Face.body(13),
                    color = Nocturne.text(65),
                )
                // Back to the capture screen, where the event is still filled in
                // and another scan can be chosen or taken.
                SecondaryButton(onClick = { model.back() }) {
                    Text("Try another scan")
                }
            } else if (scan != null) {
                Text(
                    summary(model, scan),
                    style = Nocturne.Face.body(13),
                    color = Nocturne.text(68),
                )

                if (model.refusedPages.isEmpty()) {
                    // Disabled, not hidden, when the list is empty -- nothing
                    // was found, or everything was taken as read. The summary
                    // above says which, and the button still standing there
                    // says the read itself worked.
                    PrimaryButton(
                        onClick = { model.startChecking() },
                        enabled = model.cells.isNotEmpty(),
                    ) {
                        Text("Start checking")
                    }
                } else {
                    // A page that would not line up is shown before any cell is,
                    // because its rows are about to be missing from the sheet
                    // and the volunteer is the only one who can say whether that
                    // matters.
                    PrimaryButton(onClick = { model.push(Screen.Refused) }) {
                        Text("Look at that page first")
                    }
                }
            }
        }
    }
}

// Steps

@Composable
private fun RowScope.StepMarkSlot(done: Boolean) {
    // A step that finishes while the screen is showing lands rather than
    // appears. iOS asks for the symbol's own bounce; Compose has no symbol
    // effects, so the check springs in from nothing on the system's standard
    // bouncy spring instead. Started at full size when the step was already
    // done on arrival -- coming back to this screen from the reviewer should not
    // replay a read that finished minutes ago.
    val scale = remember { Animatable(if (done) 1f else 0f) }
    LaunchedEffect(done) {
        if (done) {
            scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
        } else {
            scale.snapTo(0f)
        }
    }

    // The mark sits on the label's first baseline, as it does in the Swift's
    // `.firstTextBaseline` stack. A dot has a baseline of its own; the icon does
    // not, so its foot is what goes on the line, which is where an SF Symbol
    // sits beside text.
    if (done) {
        Box(
            modifier = Modifier
                .width(16.dp)
                .alignBy { it.measuredHeight },
            contentAlignment = Alignment.BottomStart,
        ) {
            Icon(
                Nocturne.Icon.check,
                contentDescription = null,
                tint = Nocturne.accent,
                modifier = Modifier
                    .size(13.dp)
                    .graphicsLayer {
                        scaleX = scale.value
                        scaleY = scale.value
                    },
            )
        }
    } else {
        // The Swift gives the dot no font of its own, so it is drawn in the
        // default body face, which is 17pt on iOS. Carried over at that size
        // rather than left to the 13sp body style TallyApp provides, which would
        // draw it smaller than the design does.
        Text(
            "·",
            style = Nocturne.Face.label(17),
            color = Nocturne.accent,
            modifier = Modifier
                .width(16.dp)
                .alignByBaseline(),
        )
    }
}

@Composable
private fun StepRow(step: Step) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        StepMarkSlot(step.done)

        // Weighted rather than followed by a weighted spacer: the label keeps
        // its natural start and wraps if it must, and the fixed spacer after it
        // is the Swift's `Spacer(minLength: 8)` at its minimum.
        Text(
            step.label,
            style = Nocturne.Face.label(14),
            color = if (step.done) Nocturne.text else Nocturne.text(45),
            modifier = Modifier
                .weight(1f)
                .alignByBaseline(),
        )

        Spacer(Modifier.width(8.dp))

        // Blank until the step is done. Mid-read these counts are zeros and
        // partial totals, and "0 cells" beside a step still under way would say
        // the opposite of what is happening.
        Text(
            if (step.done) step.note else "",
            style = Nocturne.Face.label(12),
            color = Nocturne.text(45),
            modifier = Modifier.alignByBaseline(),
        )
    }
}

private data class Step(
    val label: String,
    val note: String,
    val done: Boolean,
)

private fun steps(model: TallyModel): List<Step> {
    val scan = model.scan
    val progress = model.engine.progress
    val aligned = scan?.pages?.count { it.trusted }
    val total = scan?.pageCount ?: progress.total ?: 0
    val cells = model.allCells.size

    return listOf(
        Step(
            label = "Pages read",
            note = "$total page${if (total == 1) "" else "s"}",
            done = scan != null || (progress.pageNumber ?: 0) > 0,
        ),
        Step(
            label = "Pages squared up and aligned",
            note = aligned?.let { "$it of $total" } ?: "",
            done = scan != null,
        ),
        Step(
            label = "Fronts and backs paired into cards",
            note = scan?.let { "${it.cards.size} card${if (it.cards.size == 1) "" else "s"}" } ?: "",
            done = scan != null,
        ),
        Step(
            label = "Looking for handwriting",
            note = "$cells cell${if (cells == 1) "" else "s"}",
            done = scan != null,
        ),
    )
}

// Words

/**
 * Full the moment the result is in, whatever the engine last managed to post:
 * a bar short of the end beside "Done." would contradict the caption under it.
 */
private fun fraction(model: TallyModel): Float =
    if (model.scan != null) 1f else model.engine.progress.fraction.toFloat()

private fun caption(model: TallyModel): String {
    if (model.readingError != null) return "Stopped."
    if (model.scan != null) return "Done."
    val progress = model.engine.progress
    val page = progress.pageNumber
    val total = progress.total
    if (page != null && total != null) {
        return "Page $page of $total — nothing leaves the phone."
    }
    return "Opening the reference card — nothing leaves the phone."
}

private fun summary(model: TallyModel, scan: ScanResult): String {
    val cards = scan.cards.size
    val cells = model.allCells.size
    var text = "$cards card${if (cards == 1) "" else "s"}, $cells cell${if (cells == 1) "" else "s"} with something written in them."
    // The count found and the count to check are different numbers now, and
    // the gap is the cells this screen is the last chance to mention: they
    // are filled in, exported, and on no screen after this one.
    if (model.takenAsReadCount > 0) {
        text += " ${model.takenAsReadCount} were read confidently and filled in for you; ${model.cells.size} left to check."
    }
    val refused = model.refusedPages.size
    if (refused > 0) {
        text += " $refused page${if (refused == 1) "" else "s"} would not line up."
    }
    return text
}
