//
//  3 — Capture
//
//  Two ways in, as two separate buttons, because they are two different jobs:
//  photographing the cards at the cleanup, and picking up a scan somebody made
//  on the chapter's scanner.
//
//  THE CAMERA CAME BACK, AND HOW. Image input was removed from this app once,
//  deliberately -- ios/README.md: "a photograph held at an angle keystones, and
//  registration corrects rotation and scale but not that." That is right about
//  a plain camera, which is why this is not one. ML Kit's document scanner
//  finds the page's corners and rectifies the perspective before handing the
//  image over, so the pipeline gets a flat page. See DocumentScanner.kt.
//
//  WHAT IS STILL UNMEASURED is resolution: the pipeline expects 200 DPI on the
//  card's short edge, and whether a handheld capture clears that in beach light
//  has never been tested on a real card. The capture path preserves whatever
//  the camera gives rather than resampling it, and the screen says plainly that
//  the scanner is the surer route.
//
//  IT IS A WALL, not a warning, as it has been on iOS since 1 September 2026,
//  and it stands for every build that did not ask to be let past it. Shipping
//  an unmeasured reading path to volunteers who cannot tell a bad capture from
//  a good one is how you get wrong numbers into a dataset nobody re-checks. The
//  button is behind `Beta.cameraCapture`, below; the code underneath it is
//  untouched and one build flag away.
//
//  The frame below is drawn rather than live, and is doing real work as a
//  picture of what a usable page looks like: all four corners in, flat paper,
//  no shadow across the totals column. That is the advice that decides whether
//  a page registers.
//

package com.mateobesse.surfriderdatacards.tally.screens

import android.app.Activity
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.mateobesse.surfriderdatacards.BuildConfig
import com.mateobesse.surfriderdatacards.tally.ButtonIcon
import com.mateobesse.surfriderdatacards.tally.CapturedPages
import com.mateobesse.surfriderdatacards.tally.ChromeButton
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.SecondaryButton
import com.mateobesse.surfriderdatacards.tally.Tag
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.pageMargin

/**
 * What is here to be tried rather than relied on.
 *
 * The camera is the only one so far, and it is here rather than deleted
 * because nothing is wrong with the code. ML Kit's scanner rectifies the page
 * and the pipeline receives a flat one; `CapturedPages.pdf` preserves the
 * capture's pixels instead of resampling them. Both of those took work and
 * both are right.
 *
 * What has never been taken is the one number that decides whether the path is
 * worth having: the reading wants 200 DPI on the card's short edge, and
 * whether a handheld capture clears that in beach light has not been measured
 * on a real card. The design handoff calls that "the biggest open risk in the
 * whole concept".
 *
 * So the answer is not to throw the path away and not to leave it sitting
 * beside the scanner as though the two were equal. It is gated, and it says
 * what it is.
 *
 * **Measure it on a real card before this becomes an ordinary button.**
 */
object Beta {
    /**
     * Photographing the cards instead of scanning them.
     *
     * A BuildConfig field set from a Gradle property rather than a constant in
     * this file, so that turning it on is something a build has to ask for and
     * not something a person has to remember to turn off. gradle.properties
     * says false, and a build headed for the store cannot pick it up by
     * forgetting something:
     *
     *     ./gradlew assembleDebug -Ptally.beta=true
     *
     * The flag is the whole gate, which it is not on iOS. There the scanner
     * needs a camera permission that store builds ship without, so a BETA
     * build also checks at run time that the permission was injected -- iOS
     * terminates an app that opens the camera without it. Nothing like that
     * can go wrong here: ML Kit's scanner runs inside Google Play services, in
     * its own activity with its own camera access, and this app declares no
     * camera permission in any build. There is nothing a beta build could have
     * missed, so there is nothing to check.
     *
     * Whether the phone has the scanner at all is a separate question, asked
     * by `CapturedPages.scanningAvailable`. It greys the button out rather than
     * hiding it, exactly as on iOS.
     */
    val cameraCapture: Boolean get() = BuildConfig.CAMERA_CAPTURE
}

@Composable
fun CaptureScreen(model: TallyModel) {
    val context = LocalContext.current
    val activity = LocalActivity.current

    // Saveable because the phone may recreate this activity while the
    // scanner's own is in front of it, and the reason a scan could not start is
    // still the reason when the volunteer comes back.
    var problem by rememberSaveable { mutableStateOf<String?>(null) }

    // A Play services lookup, not free, and the answer does not change while
    // the screen is up. Only asked in a build that offers the camera: a store
    // build never touches Play services or ML Kit at all.
    val scanningAvailable = remember(context) { Beta.cameraCapture && CapturedPages.scanningAvailable(context) }

    // The system document picker, which is iOS's PDFPicker in all the ways
    // that mattered there. It presents from a launcher rather than from a
    // modifier stacked beside the scanner's, so there is nothing for one
    // presentation to swallow; and the grant it hands back is temporary, so
    // `readPicked` copies the file into the app's cache before anything reads
    // it -- the same reason PDFPicker asks for `asCopy`. See Files.kt.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) model.readPicked(uri)
    }

    // The scanner is Play services' own activity, handed over as an
    // IntentSender. Cancelling it comes back as anything but RESULT_OK, and
    // nothing happens -- as nothing happens when the iOS scanner is dismissed.
    // Binding the pages into a PDF can fail too, and says so through
    // `importProblem`, because that happens in the model.
    val scan = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val pages = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
                ?.pages
                ?.map { it.imageUri }
                .orEmpty()
            if (pages.isNotEmpty()) model.readCaptured(pages)
        }
    }

    // iOS presents its scanner and cannot fail to. This one is fetched first,
    // and the fetch can: Play services too old, or a phone the scanner will
    // not run on. That is said under the buttons rather than swallowed, or the
    // button would look dead.
    val startScanning: () -> Unit = {
        val host = activity
        if (host != null) {
            // Made on the tap, not with the screen: the client is ML Kit
            // starting up, and nothing that is switched off should pay for that.
            CapturedPages.scanner().getStartScanIntent(host)
                .addOnSuccessListener(host) { sender ->
                    scan.launch(IntentSenderRequest.Builder(sender).build())
                }
                .addOnFailureListener(host) { e ->
                    problem = e.localizedMessage
                        ?.let { "The document scanner could not be opened: $it" }
                        ?: "The document scanner could not be opened."
                }
        }
    }

    val pick: () -> Unit = { picker.launch(arrayOf("application/pdf", "application/octet-stream")) }

    ScreenBody(ground = Nocturne.captureGround) {
        // The only way back in the bar is Cancel. The system back gesture does
        // the same thing, from the stack in TallyApp.kt.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(Nocturne.navBar)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChromeButton(onClick = { model.back() }) {
                Text("Cancel")
            }
            Spacer(Modifier.weight(1f))
            Text(
                "A scan, front and back, in card order",
                style = Nocturne.Face.label(13),
                color = Nocturne.text(60),
            )
        }

        // Face.title carries the -1% tracking iOS sets by hand.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 26.dp, bottom = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("The cards", style = Nocturne.Face.title(22), color = Nocturne.text)
            Text(
                "One PDF per cleanup, scanned front-and-back",
                style = Nocturne.Face.body(13),
                color = Nocturne.accent300,
            )
        }

        // The frame and the Spacer under it, in one column that takes whatever
        // the bar, the title and the buttons leave. The frame is 3:4 and
        // shrinks to fit a short screen rather than pushing the buttons off it
        // -- height first, so it narrows instead of overflowing -- and the
        // room it does not use falls below it, which is where iOS's
        // `Spacer(minLength: 0)` puts it. A weighted Spacer beside a weighted
        // frame would not do: a Column splits the room between them before
        // either is measured, and the frame would get half.
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(top = 6.dp)
                .pageMargin(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Viewfinder(
                Modifier
                    .weight(1f, fill = false)
                    .aspectRatio(3f / 4f, matchHeightConstraintsFirst = true)
                    .clip(RoundedCornerShape(Nocturne.Radius.viewfinder)),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .pageMargin()
                .padding(top = 14.dp)
                .navigationBarsPadding()
                .padding(bottom = Nocturne.aboveNavBar),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            model.pendingPdf?.let { waiting ->
                PrimaryButton(onClick = {
                    model.pendingPdf = null
                    model.read(waiting)
                }) {
                    ButtonIcon(Nocturne.Icon.spreadsheet)
                    Text(
                        "Read ${waiting.name}",
                        maxLines = 1,
                        overflow = TextOverflow.MiddleEllipsis,
                    )
                }
            }

            if (Beta.cameraCapture) {
                PrimaryButton(onClick = startScanning, enabled = scanningAvailable) {
                    ButtonIcon(Nocturne.Icon.capture)
                    // Measured after the icon and the tag, so that on a narrow
                    // phone it is the words that wrap and never the tag that
                    // is squeezed out.
                    Text("Take pictures of the cards", modifier = Modifier.weight(1f, fill = false))
                    // Said on the control itself, not only in the hint
                    // underneath. Somebody choosing between two buttons is
                    // entitled to know one of them is unproven at the moment
                    // they choose.
                    Tag("BETA", size = 10, tracking = 0.8f)
                }
            }

            // Secondary beside the camera, primary when it is the only way in.
            // Two different composables, so this is a branch rather than a
            // parameter.
            if (Beta.cameraCapture) {
                SecondaryButton(onClick = pick, minHeight = 52.dp, size = 16) { PickLabel() }
            } else {
                PrimaryButton(onClick = pick) { PickLabel() }
            }

            // "Choose from Drive" sat here on iOS, with its download progress
            // and its own problem line under it, and a sheet for Google's
            // picker. None of it is in this build: Drive needs the network, and
            // this app holds no INTERNET permission, on purpose -- see
            // AndroidManifest.xml. Nothing is lost for reaching a scan: the
            // system document picker above already opens Drive when the Drive
            // app is on the phone.

            val shown = problem ?: model.importProblem
            if (shown != null) {
                Text(
                    shown,
                    style = Nocturne.Face.label(12),
                    color = Nocturne.accent400,
                    textAlign = TextAlign.Center,
                )
            } else {
                // Face.body's 1.5 leading is the handoff's; iOS reaches for it
                // with `lineSpacing(2)` because its fonts have no line height
                // to set.
                Text(
                    hint(scanningAvailable),
                    style = Nocturne.Face.body(12),
                    color = Nocturne.text(42),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun PickLabel() {
    ButtonIcon(Nocturne.Icon.scan)
    Text("Choose a scanned PDF")
}

/** What to say under the buttons. */
private fun hint(scanningAvailable: Boolean): String {
    if (!Beta.cameraCapture) {
        return "Both sides of every card, in card order, from the chapter's scanner. The reading wants 200 DPI, which is what it produces."
    }
    if (!scanningAvailable) {
        return "This device has no document scanner, so the cards have to come from a PDF. Scanned front-and-back, in card order."
    }
    return "Photograph both sides of every card, in order. The scanner's PDF is the surer route where you have one — the reading wants 200 DPI, and a phone capture has not been measured against that yet."
}

// The card guide

@Composable
private fun Viewfinder(modifier: Modifier) {
    Box(modifier) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(
                Brush.radialGradient(
                    colors = listOf(Color(0xFF1D2030), Color(0xFF0B0C14)),
                    center = Offset(size.width * 0.5f, size.height * 0.2f),
                    radius = 320.dp.toPx(),
                ),
            )

            val inset = 22.dp.toPx()
            val hairline = 1.dp.toPx()

            // Faint ruling, to suggest paper.
            val ruling = Nocturne.text(5)
            val pitch = 26.dp.toPx()
            var rule = 0f
            while (rule < size.height - 2 * inset) {
                drawLine(
                    ruling,
                    start = Offset(inset, inset + rule),
                    end = Offset(size.width - inset, inset + rule),
                    strokeWidth = hairline,
                )
                rule += pitch
            }

            // The card guide. Drawn inside its rectangle rather than centred on
            // the edge, as iOS's `strokeBorder` draws it, so the corner radius
            // comes in by the same half line.
            val half = hairline / 2
            drawRoundRect(
                color = Nocturne.accent.copy(alpha = 0.55f),
                topLeft = Offset(inset + half, inset + half),
                size = Size(size.width - 2 * inset - hairline, size.height - 2 * inset - hairline),
                cornerRadius = CornerRadius(Nocturne.Radius.thumb.toPx() - half),
                style = Stroke(
                    width = hairline,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx())),
                ),
            )

            // One path per bracket rather than two lines, so the corner is a
            // mitred join and only the two free ends are round.
            val arm = 34.dp.toPx()
            val edge = 12.dp.toPx()
            val bracket = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
            for (corner in Corner.entries) {
                val x = if (corner.isLeading) edge else size.width - edge
                val y = if (corner.isTop) edge else size.height - edge
                val path = Path().apply {
                    moveTo(if (corner.isLeading) x + arm else x - arm, y)
                    lineTo(x, y)
                    lineTo(x, if (corner.isTop) y + arm else y - arm)
                }
                drawPath(path, Nocturne.accent, style = bracket)
            }
        }

        // On iOS 26 this sits on a pane of glass. The flat path everything
        // here takes gives it a clear fill and no stroke, so there is nothing
        // to draw, and what is left is the padding that places the words where
        // that card would be.
        Text(
            "All four corners inside the frame. Flat paper, no shadow across the totals column.",
            style = Nocturne.Face.body(12),
            color = Nocturne.text(72),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                // Clear of the corner brackets. The advice is a card floating
                // in the frame, and a card that lands ON the brackets reads as
                // covering the very thing it is describing.
                .padding(start = 26.dp, end = 26.dp, bottom = 20.dp)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

private enum class Corner(val isTop: Boolean, val isLeading: Boolean) {
    TopLeading(isTop = true, isLeading = true),
    TopTrailing(isTop = true, isLeading = false),
    BottomLeading(isTop = false, isLeading = true),
    BottomTrailing(isTop = false, isLeading = false),
}
