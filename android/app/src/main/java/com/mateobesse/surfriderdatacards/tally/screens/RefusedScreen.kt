//
//  5 — A page refused
//
//  Explain a refusal in the volunteer's language and offer the fix.
//
//  RefusedScreen.swift, for Android. The threshold and the figure both come
//  from `registerAgainstBestSide` in src/lib/register.ts and are shown as they
//  are. A generic failure tells somebody the thing is broken; the real overlap
//  tells them it was probably a shadow, which is something they can do about.
//
//  "Retake page 7" is not offered, because photographing a card is not switched
//  on -- see `Beta.cameraCapture` in CaptureScreen.kt -- and even where it is, a
//  capture is a whole new scan rather than one page put back. What can be done
//  is scan it again, so that is what it says.
//

package com.mateobesse.surfriderdatacards.tally.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.mateobesse.surfriderdatacards.tally.BottomClearance
import com.mateobesse.surfriderdatacards.tally.ButtonIcon
import com.mateobesse.surfriderdatacards.tally.Kicker
import com.mateobesse.surfriderdatacards.tally.NavBar
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.ScanPage
import com.mateobesse.surfriderdatacards.tally.Screen
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.SecondaryButton
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.WithPinnedActions
import com.mateobesse.surfriderdatacards.tally.pageMargin
import java.util.Locale

/**
 * The stand-in's ruling. The one literal colour on this screen, and the same
 * literal RefusedScreen.swift writes: it is not `Nocturne.Paper.ruling`, because
 * this is not paper -- it is a drawing of a page on the text colour, and the
 * paper ruling would all but vanish against that.
 */
private val StandInRuling = Color(0xFFC3C7D2)

@Composable
fun RefusedScreen(model: TallyModel) {
    // Read once. `refusedPages` filters and sorts the scan's pages on every
    // call, and the kicker, the title, the details and the footnote all
    // describe the same list.
    val refused = model.refusedPages
    // `MIN_BANNER_OVERLAP` in register.ts, the figure the engine reports with
    // every scan. The fallback is the Swift's, and only shows with no scan in
    // hand.
    val threshold = model.scan?.minBannerOverlap ?: 0.75

    ScreenBody {
        NavBar(back = "Back", onBack = { model.back() })

        // No `.softScrollEdges()` counterpart: that is iOS 26 drawing its own
        // soft edge where content passes under a floating bar. Here, as on iOS
        // below 26, the ground fade WithPinnedActions paints above the buttons
        // does the separating.
        WithPinnedActions(
            actions = {
                PrimaryButton(
                    onClick = {
                        // Back to the picker. A better scan of the same cards
                        // is the only fix available until capture is switched
                        // on. Both screens go in one move: the reading screen
                        // underneath is reporting on the scan this one is about
                        // to replace.
                        model.path.removeAll { it == Screen.Reading || it == Screen.Refused }
                    },
                    minHeight = 50.dp,
                    size = 15,
                ) {
                    ButtonIcon(Nocturne.Icon.scan)
                    Text("Try a better scan")
                }

                // The same move as "Start checking" on screen 4: index 0, the
                // keypad loaded from the first cell, screen 6 pushed. Off when
                // the review list is empty -- every page refused, or every cell
                // taken as read -- because screen 6 would open on nothing.
                SecondaryButton(onClick = { model.startChecking() }, enabled = model.cells.isNotEmpty()) {
                    Text("Leave it out and carry on")
                }

                // Full width so that it sits flush left under the buttons, as
                // the leading-aligned stack on iOS puts it, rather than being
                // centred by the actions column. iOS adds 2pt of leading to the
                // system face here; Compose has no "extra between lines", only
                // an absolute line height the design never gave for this text,
                // so it keeps the face's own.
                Text(
                    footnote(refused),
                    style = Nocturne.Face.label(12),
                    color = Nocturne.text(42),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                )
            },
        ) { clearance ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(top = 6.dp)
                    .pageMargin(),
            ) {
                Kicker(text = refusedLabel(refused.size), icon = Nocturne.Icon.refused)
                Spacer(Modifier.height(8.dp))

                // Face.title carries the design's -1% tracking, which is the
                // -0.26 the Swift applies by hand.
                Text(
                    title(refused),
                    style = Nocturne.Face.title(26),
                    color = Nocturne.text,
                    modifier = Modifier.padding(bottom = 10.dp),
                )

                // Body at the design's 13 / 1.5. iOS reaches that by adding
                // leading to the system face's own; Compose states the line
                // height outright, so Face.body carries the number and there is
                // nothing to add.
                Text(
                    "The printed section banners did not land where they should, so we do not know which row is which. A page that is a little off gives ordinary-looking numbers attached to the wrong items, and nothing later would catch it. So it is refused rather than cropped from.",
                    style = Nocturne.Face.body(13),
                    color = Nocturne.text(65),
                )

                for (page in refused) {
                    key(page.pageNumber) {
                        PageDetail(page, threshold, Modifier.padding(top = 20.dp))
                    }
                }

                BottomClearance(clearance)
            }
        }
    }
}

@Composable
private fun PageDetail(page: ScanPage, threshold: Double, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        PageStandIn()

        // Weighted so that the text wraps in what the stand-in leaves, which is
        // what the Swift's VStack gets by being the flexible child of its HStack.
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val style = Nocturne.Face.body(13)
            val color = Nocturne.text(62)
            Text(
                "Page ${page.pageNumber}, read as a ${page.side}. Banner overlap ${overlap(page.bannerOverlap)} — below the ${overlap(threshold)} we trust.",
                style = style,
                color = color,
            )
            Text(
                "Usually a shadow across one side, or a page that moved. Scanning it again in flatter light generally fixes it.",
                style = style,
                color = color,
            )
        }
    }
}

/**
 * A stand-in for the page, not the page: a refused page is never cropped from,
 * so there is no picture of it to show.
 *
 * One Canvas rather than the Swift's ZStack of three layers, drawing the same
 * three things in the same order. The rotation is a layer effect, exactly as
 * `rotationEffect` is, so the row lays out around the upright 96 x 126 and the
 * tilted corners overhang it by the same few dp they do on iOS.
 */
@Composable
private fun PageStandIn() {
    Canvas(
        Modifier
            .size(width = 96.dp, height = 126.dp)
            .rotate(-3f),
    ) {
        val corner = CornerRadius(6.dp.toPx())
        val inset = 8.dp.toPx()
        val pitch = 9.dp.toPx()

        drawRoundRect(Nocturne.text, cornerRadius = corner)

        var y = inset
        while (y < size.height - inset) {
            drawLine(
                StandInRuling,
                start = Offset(inset, y),
                end = Offset(size.width - inset, y),
                strokeWidth = 1.dp.toPx(),
            )
            y += pitch
        }

        // The design's diagonal shadow across the page: a picture of the usual
        // cause the lines beside it name. `.topLeading` to `.bottomTrailing`,
        // written as top-left to bottom-right: it is a picture of light
        // falling on paper, not of reading order, so it has no reason to
        // mirror in a right-to-left layout.
        drawRoundRect(
            Brush.linearGradient(
                0.45f to Color.Transparent,
                0.85f to Color.Black.copy(alpha = 0.22f),
                start = Offset.Zero,
                end = Offset(size.width, size.height),
            ),
            cornerRadius = corner,
        )
    }
}

private fun refusedLabel(n: Int): String = "$n page${if (n == 1) "" else "s"} refused"

private fun title(pages: List<ScanPage>): String {
    val first = pages.firstOrNull() ?: return "Every page lined up"
    return if (pages.size == 1) "Page ${first.pageNumber} would not line up"
    else "${pages.size} pages would not line up"
}

/**
 * Two decimals with a point, always. `String(format:)` on iOS is not localised,
 * and a figure checked against register.ts should not become "0,68" on a phone
 * set to French; Locale.US is how Java's formatter says the same thing.
 */
private fun overlap(value: Double): String = String.format(Locale.US, "%.2f", value)

private fun footnote(pages: List<ScanPage>): String {
    val which = pages.map { it.side }.distinct().sorted().joinToString(" and ")
    return "Leaving them out means those $which rows are blank in the spreadsheet. You can scan the cards again at any point before you send it."
}
