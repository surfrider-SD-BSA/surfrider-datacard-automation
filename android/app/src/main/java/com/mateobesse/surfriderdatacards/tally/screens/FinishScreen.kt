//
//  8 — Finish and send
//
//  The export gate: warnings, not walls. You can send it anyway -- you are the
//  one who saw the paper. A warning somebody can override beats a gate they
//  route around, which is the argument in `checkExportGate` in
//  src/lib/schema.ts and the reason nothing here refuses.
//
//  FinishScreen.swift, for Android, with one button fewer and one more.
//
//  FEWER: there is no Save to Drive. This build holds no INTERNET permission,
//  so "the scan stays on this phone" is enforced by the operating system rather
//  than promised (see AndroidManifest.xml), and a Drive upload would be the
//  first thing in the app to need the network. What that button did is still
//  within reach without it: the share sheet and the system save dialog both
//  reach Drive through the Drive app, which does its own networking.
//
//  MORE: "Save a copy". The note on why is on the button.
//

package com.mateobesse.surfriderdatacards.tally.screens

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mateobesse.surfriderdatacards.tally.BottomClearance
import com.mateobesse.surfriderdatacards.tally.ButtonIcon
import com.mateobesse.surfriderdatacards.tally.NavBar
import com.mateobesse.surfriderdatacards.tally.Nocturne
import com.mateobesse.surfriderdatacards.tally.PrimaryButton
import com.mateobesse.surfriderdatacards.tally.ScreenBody
import com.mateobesse.surfriderdatacards.tally.SecondaryButton
import com.mateobesse.surfriderdatacards.tally.Spreadsheet
import com.mateobesse.surfriderdatacards.tally.TallyModel
import com.mateobesse.surfriderdatacards.tally.WithPinnedActions
import com.mateobesse.surfriderdatacards.tally.pageMargin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.PI
import kotlin.math.pow

@Composable
fun FinishScreen(model: TallyModel) {
    // The screen's scope and the screen's flag, not the gate's: the gate leaves
    // composition the moment `exportedFile` lands, and a scope that went with
    // it would be cancelled under the tail of the export it started.
    //
    // Leaving the SCREEN mid-export does cancel it, where iOS's unstructured
    // Task would have carried on. Nothing is left half-done by that: the file
    // only counts once `exportedFile` is set, and the draft is only cleared
    // after that, so the volunteer comes back to the gate and taps again.
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }

    // The iOS share sheet was a `.sheet` bound to a flag; Android's is another
    // activity, started straight from the button, so there is no flag. The
    // Drive folder picker that also hung off this screen is gone with Drive --
    // see the header.
    ScreenBody {
        NavBar(back = "Cards", onBack = { model.back() })

        val file = model.exportedFile
        if (file != null) {
            Success(model, file, scope)
        } else {
            Gate(
                model = model,
                working = working,
                onMake = {
                    // Set before the launch, not inside it, so a second tap in
                    // the same frame finds the button already disabled.
                    working = true
                    scope.launch {
                        try {
                            model.makeSpreadsheet()
                        } finally {
                            working = false
                        }
                    }
                },
            )
        }
    }
}

// The gate

@Composable
private fun ColumnScope.Gate(model: TallyModel, working: Boolean, onMake: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .pageMargin()
            .padding(top = 6.dp, bottom = 18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Before it goes", style = Nocturne.Face.title(28), color = Nocturne.text)
        Text(
            "Warnings, not walls. You can send it anyway — you are the one who saw the paper.",
            style = Nocturne.Face.body(13),
            color = Nocturne.text(60),
        )
    }

    WithPinnedActions(
        actions = {
            // Disabled only for what a spreadsheet cannot be made without: a
            // value to put in it, and the date and beach it is filed under.
            // Everything else is a warning above, and a warning never stops it.
            PrimaryButton(
                onClick = onMake,
                enabled = !working && model.values.isNotEmpty() && model.event.isComplete,
            ) {
                // The spinner takes the icon's place rather than the label's,
                // so the button still says what it is doing while it does it.
                if (working) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = Nocturne.accent,
                        strokeWidth = 2.dp,
                    )
                } else {
                    ButtonIcon(Nocturne.Icon.spreadsheet)
                }
                Text("Make the spreadsheet")
            }
        },
    ) { clearance ->
        // iOS softens the scroll edge under the button on iOS 26 only; the
        // flat path, which is this one, leaves it to the pinned actions' own
        // fade.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .pageMargin(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                for (item in model.gateItems) GateRow(item)

                model.exportError?.let { error ->
                    Text(
                        error,
                        style = Nocturne.Face.body(13),
                        color = Nocturne.accent400,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            BottomClearance(clearance)
        }
    }
}

/**
 * One warning, pass or note. Outlined and unfilled: the flat path of the
 * control surface these sit on in iOS, which on glass would have been a pane.
 * They are not tappable, and a fill would make them look as if they were.
 */
@Composable
private fun GateRow(item: TallyModel.GateItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Nocturne.divider, RoundedCornerShape(Nocturne.Radius.base))
            .padding(vertical = 13.dp, horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(11.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            item.icon,
            contentDescription = null,
            tint = item.color,
            modifier = Modifier
                .padding(top = 1.dp)
                .size(17.dp),
        )
        Text(
            item.text,
            style = Nocturne.Face.body(13),
            color = Nocturne.text(78),
            modifier = Modifier.weight(1f),
        )
    }
}

// Sent

@Composable
private fun ColumnScope.Success(model: TallyModel, file: File, scope: CoroutineScope) {
    val context = LocalContext.current

    // Null until a save has been tried. Keyed on the file, because an outcome
    // is about one file and a new export is a different one.
    var saved by remember(file) { mutableStateOf<Boolean?>(null) }

    val saveCopy = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(Spreadsheet.MIME)) { uri ->
        // Null is the volunteer closing the dialog. Nothing was tried, so
        // nothing is said, and an earlier "Saved." still stands.
        if (uri != null) {
            // Off the main thread: the destination is whatever provider the
            // volunteer picked, and Drive's, for one, is not a local disk.
            scope.launch {
                saved = withContext(Dispatchers.IO) { Spreadsheet.saveCopy(context, file, uri) }
            }
        }
    }

    // Centred, as the Swift is between two spacers, but able to scroll: at the
    // largest font sizes Android offers, this column is taller than a small
    // phone, and one that could not scroll would put "Back to cleanups" out of
    // reach. When it fits, it sits exactly where the spacers put it.
    //
    // iOS pads the foot by 60pt, most of which is its home-indicator clearance.
    // Here the navigation bar's own inset does that, and `aboveNavBar` is the
    // room above it.
    BoxWithConstraints(
        modifier = Modifier
            .weight(1f)
            .fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .navigationBarsPadding()
                .padding(horizontal = 26.dp)
                .padding(bottom = Nocturne.aboveNavBar),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Badge()

            Text(
                "Ready to send",
                style = Nocturne.Face.title(26),
                color = Nocturne.text,
                modifier = Modifier.padding(top = 22.dp, bottom = 8.dp),
            )

            Text(
                model.exportedFile?.name ?: model.exportName,
                style = Nocturne.Face.label(14),
                color = Nocturne.text(65),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 4.dp),
            )

            val values = model.checkedCount
            val cards = model.scan?.cards?.size ?: 0
            Text(
                "$values value${if (values == 1) "" else "s"}, $cards card${if (cards == 1) "" else "s"}, in the chapter's template",
                style = Nocturne.Face.label(12),
                color = Nocturne.text(42),
                textAlign = TextAlign.Center,
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 30.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PrimaryButton(onClick = { Spreadsheet.share(context, file) }) {
                    ButtonIcon(Nocturne.Icon.share)
                    Text("Send it on")
                }

                // iOS has "Save to Drive" here: the other direction of the
                // capture screen's Drive button, putting the spreadsheet back
                // beside the scans. Absent on Android for the reason in the
                // header -- no network permission -- and this is what stands in
                // its place.
                //
                // NEW ON ANDROID. iOS's share sheet has Save to Files built in,
                // so "Send it on" was also how the file was kept. Android's
                // lists apps, and "this phone" is not one of them, so without
                // this the only way to keep a copy would be to send it to
                // yourself. The system save dialog also lists Drive when the
                // Drive app is installed, which covers most of what the Drive
                // button did without this app touching the network.
                SecondaryButton(
                    onClick = {
                        // A phone whose document picker has been disabled
                        // cannot show the dialog at all. That is a save that
                        // failed, and it is said the same way.
                        try {
                            saveCopy.launch(file.name)
                        } catch (e: ActivityNotFoundException) {
                            saved = false
                        }
                    },
                ) {
                    ButtonIcon(Nocturne.Icon.save)
                    Text("Save a copy")
                }

                SecondaryButton(onClick = { model.backToCleanups() }) {
                    Text("Back to cleanups")
                }
            }

            // How the save went, said here rather than in a toast or a dialog:
            // the button that caused it is right above, and an hour of work is
            // not lost either way -- the file is still on the phone and "Send
            // it on" still works. Where iOS said Drive's refusals.
            saved?.let { ok ->
                Text(
                    if (ok) "Saved." else "That copy could not be saved. Send it on instead — the file is still on this phone.",
                    style = Nocturne.Face.label(12),
                    color = if (ok) Nocturne.text(42) else Nocturne.accent400,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .padding(top = 14.dp)
                        .pageMargin(),
                )
            }

            // The last thing said before the file leaves, because it is the
            // one promise the whole tool is built on -- and on Android, the
            // one the system holds the app to.
            Text(
                "The scan stays on this phone. Only the spreadsheet leaves.",
                style = Nocturne.Face.label(12),
                color = Nocturne.text(42),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 18.dp),
            )
        }
    }
}

// The badge

private val HaloDiameter = 78.dp
private val HaloBlur = 18.dp

/**
 * SwiftUI's `.spring(response: 0.42, dampingFraction: 0.68)`, converted. The
 * damping fraction is Compose's damping ratio as it stands; a response of r
 * seconds is a stiffness of (2π/r)² at the unit mass both assume.
 */
private val Landing = spring<Float>(
    dampingRatio = 0.68f,
    stiffness = (2 * PI / 0.42).pow(2).toFloat(),
)

/**
 * The mark of a finished export: a lit halo, and the check in a ring.
 *
 * The badge lands rather than appears. One spring, once, on the one screen
 * that is telling somebody an hour of work is finished. iOS also bounces the
 * check itself, with a symbol effect; Material icons have no counterpart, and
 * the badge's own spring is the landing here.
 */
@Composable
private fun Badge() {
    val landing = remember { Animatable(0f) }
    LaunchedEffect(Unit) { landing.animateTo(1f, animationSpec = Landing) }

    // Faded by colour rather than by a layer's alpha. A layer below full alpha
    // is drawn offscreen at its own bounds -- the 64dp ring -- and would cut
    // the halo off square until the fade finished. The spring overshoots, which
    // the scale is meant to show and an opacity cannot.
    val shown = landing.value.coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .size(64.dp)
            .graphicsLayer {
                // Read here rather than in composition, so the scale moves
                // with the frame and not with a recomposition.
                val scale = 0.82f + 0.18f * landing.value
                scaleX = scale
                scaleY = scale
            },
        contentAlignment = Alignment.Center,
    ) {
        // A halo rather than a second ring: a hard-edged disc behind a 64dp
        // circle reads as a grey band around it, which is what the first pass
        // on iOS drew.
        //
        // The layer is laid out with room for the whole spread of the blur and
        // the disc drawn in the middle of it, so nothing depends on whether a
        // blur may draw past its own layer. The blur itself is Android 12 and
        // up; below that the modifier is ignored and the halo is the plain
        // translucent disc.
        Box(
            Modifier
                .requiredSize(HaloDiameter + HaloBlur * 4)
                .blur(HaloBlur, BlurredEdgeTreatment.Unbounded)
                .drawBehind {
                    drawCircle(Nocturne.accent.copy(alpha = 0.16f * shown), radius = HaloDiameter.toPx() / 2)
                },
        )

        // The flat path of iOS's control surface: no fill, the accent stroke.
        // On glass the check is accent300, to carry on the pane; on the
        // ground it is the accent itself.
        Box(
            modifier = Modifier
                .fillMaxSize()
                .border(1.dp, Nocturne.accent.copy(alpha = shown), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Nocturne.Icon.check,
                contentDescription = null,
                tint = Nocturne.accent.copy(alpha = shown),
                modifier = Modifier.size(26.dp),
            )
        }
    }
}
