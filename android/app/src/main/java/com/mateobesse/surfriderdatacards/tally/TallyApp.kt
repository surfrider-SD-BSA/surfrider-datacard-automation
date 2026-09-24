//
//  The push stack.
//
//  RootView.swift, for Android. A stack and nothing else: no bottom bar, and no
//  screen-jump list -- that was a prototype affordance in the design file and
//  the handoff says so. Back pops, from the nav bar or the system gesture.
//
//  The stack is the model's `path` rather than a navigation library's, because
//  the model moves the reviewer the way it does on iOS -- replacing the whole
//  stack, popping two screens at once -- and a list it owns is the plainest
//  thing that can do all of that.
//

package com.mateobesse.surfriderdatacards.tally

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.mateobesse.surfriderdatacards.tally.screens.CaptureScreen
import com.mateobesse.surfriderdatacards.tally.screens.CardsScreen
import com.mateobesse.surfriderdatacards.tally.screens.CleanupsScreen
import com.mateobesse.surfriderdatacards.tally.screens.EventScreen
import com.mateobesse.surfriderdatacards.tally.screens.FinishScreen
import com.mateobesse.surfriderdatacards.tally.screens.ReadingScreen
import com.mateobesse.surfriderdatacards.tally.screens.RefusedScreen
import com.mateobesse.surfriderdatacards.tally.screens.ReviewScreen

/**
 * Material components are used in two places -- the date picker and the
 * spinner -- and this is what they draw with, so they come out in Nocturne
 * rather than in the platform's colours.
 */
private val NocturneScheme = darkColorScheme(
    primary = Nocturne.accent,
    onPrimary = Nocturne.ground,
    primaryContainer = Nocturne.accent800,
    onPrimaryContainer = Nocturne.text,
    secondary = Nocturne.accent400,
    onSecondary = Nocturne.ground,
    background = Nocturne.ground,
    onBackground = Nocturne.text,
    surface = Nocturne.surface,
    onSurface = Nocturne.text,
    onSurfaceVariant = Nocturne.text(70),
    surfaceContainerHigh = Nocturne.surface,
    surfaceContainerHighest = Nocturne.surface,
    outline = Nocturne.divider,
    outlineVariant = Nocturne.divider,
)

/** Which screen, at what depth. The depth is what tells a push from a pop. */
private data class StackTop(val depth: Int, val screen: Screen?)

@Composable
fun TallyApp(model: TallyModel) {
    MaterialTheme(colorScheme = NocturneScheme) {
        CompositionLocalProvider(
            LocalContentColor provides Nocturne.text,
            LocalTextStyle provides Nocturne.Face.body(),
        ) {
            Box(Modifier.fillMaxSize().background(Nocturne.ground)) {
                // The engine's WebView. One pixel, invisible, and in the window
                // on purpose -- see the note at the top of Engine.kt. Keyed on
                // the engine's generation so that a WebView replaced after the
                // system killed the old one is planted in its turn.
                key(model.engine.generation) {
                    AndroidView(
                        factory = { model.engine.host() },
                        // Nothing for a screen reader either: the page's title
                        // was being announced as though it were a control.
                        modifier = Modifier.size(1.dp).alpha(0f).clearAndSetSemantics {},
                    )
                }

                Stack(model)
            }
        }
    }
}

@Composable
private fun Stack(model: TallyModel) {
    BackHandler(enabled = model.path.isNotEmpty()) { model.back() }

    AnimatedContent(
        targetState = StackTop(model.path.size, model.path.lastOrNull()),
        transitionSpec = {
            val push = targetState.depth >= initialState.depth
            val duration = 280
            if (push) {
                (slideInHorizontally(tween(duration)) { it } + fadeIn(tween(duration)))
                    .togetherWith(slideOutHorizontally(tween(duration)) { -it / 4 } + fadeOut(tween(duration)))
            } else {
                (slideInHorizontally(tween(duration)) { -it / 4 } + fadeIn(tween(duration)))
                    .togetherWith(slideOutHorizontally(tween(duration)) { it } + fadeOut(tween(duration)))
            }
        },
        label = "stack",
    ) { top ->
        when (top.screen) {
            null -> CleanupsScreen(model)
            Screen.Event -> EventScreen(model)
            Screen.Capture -> CaptureScreen(model)
            Screen.Reading -> ReadingScreen(model)
            Screen.Refused -> RefusedScreen(model)
            Screen.Review -> ReviewScreen(model)
            Screen.Cards -> CardsScreen(model)
            Screen.Finish -> FinishScreen(model)
        }
    }
}
