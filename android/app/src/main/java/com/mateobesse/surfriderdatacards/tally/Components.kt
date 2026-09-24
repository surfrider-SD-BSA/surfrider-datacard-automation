//
//  The controls the eight screens are built from.
//
//  Components.swift, in Compose. The pressed states are the part worth keeping:
//  the handoff is explicit that every control tints from the accent ramp and
//  that no platform default is used. Android's default is the ripple, which is
//  a different gesture from "being held", so every control here draws its own
//  pressed state and passes `indication = null`.
//

package com.mateobesse.surfriderdatacards.tally

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Feedback

/**
 * The part of a tap you feel before you can see anything.
 *
 * Screen 6 is a keypad somebody works at for an hour, and a keypad with no
 * haptic reads as lag even when the digit lands in the same frame. These are
 * the system's own keyboard constants, so they follow the phone's touch
 * feedback setting rather than overriding it.
 */
object Haptics {
    /** A digit. */
    fun tap(view: View) {
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    /** A value committed and the screen moving on. */
    fun advance(view: View) {
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
            else HapticFeedbackConstants.VIRTUAL_KEY,
        )
    }
}

// Buttons

private enum class ButtonKind { Primary, Secondary }

/**
 * Outlined in the accent. The affirmative action on every screen.
 *
 * Stretches, like the SwiftUI style it comes from; pass `stretch = false` for
 * the one place a button is the width of its label.
 */
@Composable
fun PrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    minHeight: Dp = 52.dp,
    size: Int = 16,
    stretch: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) = NocturneButton(ButtonKind.Primary, onClick, modifier, enabled, minHeight, size, stretch, content)

/** Outlined in the divider. The way out, or the lesser of two actions. */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    minHeight: Dp = 50.dp,
    size: Int = 15,
    stretch: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) = NocturneButton(ButtonKind.Secondary, onClick, modifier, enabled, minHeight, size, stretch, content)

@Composable
private fun NocturneButton(
    kind: ButtonKind,
    onClick: () -> Unit,
    modifier: Modifier,
    enabled: Boolean,
    minHeight: Dp,
    size: Int,
    stretch: Boolean,
    content: @Composable RowScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(Nocturne.Radius.base)

    val fill = when (kind) {
        ButtonKind.Primary -> Nocturne.accent.copy(alpha = if (pressed) 0.22f else 0f)
        ButtonKind.Secondary -> Nocturne.text.copy(alpha = if (pressed) 0.14f else 0f)
    }
    val stroke = if (kind == ButtonKind.Primary) Nocturne.accent else Nocturne.divider
    val label = if (kind == ButtonKind.Primary) Nocturne.accent else Nocturne.text

    Row(
        modifier = modifier
            .then(if (stretch) Modifier.fillMaxWidth() else Modifier)
            .defaultMinSize(minHeight = minHeight)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(shape)
            .background(fill)
            .border(1.dp, stroke, shape)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            // Room inside the outline -- see the note in Components.swift.
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(
            LocalContentColor provides label,
            LocalTextStyle provides Nocturne.Face.label(size, FontWeight.Medium),
        ) { content() }
    }
}

/** An icon sized to sit beside a button's label. */
@Composable
fun ButtonIcon(icon: ImageVector) {
    Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
}

/** Accent text with no border: the small inline actions. */
@Composable
fun TextAction(text: String, onClick: () -> Unit, size: Int = 16, enabled: Boolean = true) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Text(
        text,
        style = Nocturne.Face.label(size),
        color = Nocturne.accent,
        modifier = Modifier
            .alpha(if (pressed) 0.6f else if (enabled) 1f else 0.45f)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(vertical = 6.dp),
    )
}

// Chrome

/**
 * Accent text in the nav bar. Padded out to the minimum touch target, because
 * on the nav bar it is the only thing there is to hit.
 */
@Composable
fun ChromeButton(onClick: () -> Unit, size: Int = 16, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier = Modifier
            .defaultMinSize(minHeight = Nocturne.minTap)
            .alpha(if (pressed) 0.6f else if (enabled) 1f else 0.45f)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(
            LocalContentColor provides Nocturne.accent,
            LocalTextStyle provides Nocturne.Face.label(size),
        ) { content() }
    }
}

/**
 * The back affordance: a leading caret and the destination word, in accent.
 *
 * Not a title bar. Screen titles are large and flush-left in the content, and
 * this sits above them in a bar of its own.
 */
@Composable
fun NavBar(back: String? = null, onBack: (() -> Unit)? = null, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(Nocturne.navBar)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (back != null && onBack != null) {
            ChromeButton(onBack) {
                Icon(Nocturne.Icon.back, contentDescription = null, modifier = Modifier.size(24.dp))
                Text(back)
            }
        }
        Spacer(Modifier.weight(1f))
        trailing()
    }
}

/** Uppercase, tracked, accent. Sits above a title. */
@Composable
fun Kicker(text: String, icon: ImageVector? = null, color: Color = Nocturne.accent) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(13.dp))
        Text(text.uppercase(), style = Nocturne.Face.label(11, tracking = 1.2.sp), color = color)
    }
}

/** A section label in the body: uppercase, tracked, text at 45%. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = Nocturne.Face.label(11, tracking = 1.1.sp), color = Nocturne.text(45), modifier = modifier)
}

/** The progress bar. 6dp while reading, 4dp while checking. */
@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, height: Dp = 6.dp) {
    val shown by animateFloatAsState(
        targetValue = fraction.coerceIn(0f, 1f),
        animationSpec = tween(350, easing = FastOutSlowInEasing),
        label = "progress",
    )
    val fill = remember { Brush.horizontalGradient(listOf(Nocturne.accent700, Nocturne.accent, Nocturne.accent300)) }
    Canvas(modifier.fillMaxWidth().height(height)) {
        val radius = CornerRadius(size.height / 2, size.height / 2)
        drawRoundRect(Nocturne.track, cornerRadius = radius)
        if (shown > 0f) {
            drawRoundRect(fill, size = Size(size.width * shown, size.height), cornerRadius = radius)
        }
    }
}

/** A form field: 12sp label, optional suffix at 55%, and a 46dp input. */
@Composable
fun Field(label: String, modifier: Modifier = Modifier, optional: Boolean = false, content: @Composable BoxScope.() -> Unit) {
    val shape = RoundedCornerShape(Nocturne.Radius.base)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(label, style = Nocturne.Face.label(12), color = Nocturne.text(70))
            if (optional) Text("optional", style = Nocturne.Face.label(12), color = Nocturne.text(55))
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 46.dp)
                .clip(shape)
                .background(Nocturne.surface)
                .border(1.dp, Nocturne.divider, shape)
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            CompositionLocalProvider(
                LocalContentColor provides Nocturne.text,
                LocalTextStyle provides Nocturne.Face.label(16),
            ) { content() }
        }
    }
}

/**
 * A text input inside a `Field`. Flat, on the surface the design specifies;
 * the placeholder is text at 35%, which is what a system field would draw.
 */
@Composable
fun FieldInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = Nocturne.Face.label(16).copy(color = Nocturne.text),
        cursorBrush = SolidColor(Nocturne.accent),
        keyboardOptions = keyboardOptions,
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, style = Nocturne.Face.label(16), color = Nocturne.text(35))
                inner()
            }
        },
    )
}

/** The accent-tinted panel: draft card, tally note, anything the accent frames rather than floods. */
@Composable
fun TintedPanel(modifier: Modifier = Modifier, radius: Dp = Nocturne.Radius.base, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(radius)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Nocturne.accent900)
            .border(1.dp, Nocturne.accent700, shape),
        content = content,
    )
}

/** A card the size of its content: the flat outlined panel. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(Nocturne.Radius.base)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, Nocturne.divider, shape),
        content = content,
    )
}

/** A row in a list, with the design's 1dp bottom divider and press tint. */
@Composable
fun RowButton(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Nocturne.text.copy(alpha = if (pressed) 0.05f else 0f))
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
            .drawBehind {
                drawRect(Nocturne.divider, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx()))
            },
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * The small claim a control makes about itself: which reader filled a box in,
 * or that a path is unproven.
 */
@Composable
fun Tag(text: String, size: Int = 11, tracking: Float = 0f) {
    Text(
        text,
        style = Nocturne.Face.label(size, FontWeight.Medium, tracking = tracking.sp),
        color = Nocturne.text,
        modifier = Modifier
            .clip(RoundedCornerShape(percent = 50))
            .background(Nocturne.accent800)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

// Layout

/** The page margin, everywhere. */
fun Modifier.pageMargin(): Modifier = padding(horizontal = Nocturne.margin)

/** Every screen's ground and its clearance under the status bar, in one place. */
@Composable
fun ScreenBody(
    ground: Color = Nocturne.ground,
    topPadding: Dp = Nocturne.belowStatusBar,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ground)
            .statusBarsPadding()
            .padding(top = topPadding),
        content = content,
    )
}

/**
 * A scrolling body with its actions floated over the foot of it.
 *
 * The SwiftUI screens attach these with `.safeAreaInset(edge: .bottom)`, so
 * that a long list scrolls past the button rather than stopping short of it.
 * This is the same arrangement: the actions are measured, and the content is
 * handed their height to leave clear at the end of its scroll.
 */
@Composable
fun ColumnScope.WithPinnedActions(
    actions: @Composable ColumnScope.() -> Unit,
    ground: Color = Nocturne.ground,
    content: @Composable (bottomClearance: Dp) -> Unit,
) {
    var actionsHeight by remember { mutableIntStateOf(0) }
    val clearance = with(LocalDensity.current) { actionsHeight.toDp() }

    Box(Modifier.weight(1f).fillMaxWidth()) {
        content(clearance)

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .onSizeChanged { actionsHeight = it.height }
                // `linear-gradient(to top, ground 72%, transparent)`: a list
                // dissolves before it reaches the button rather than being cut
                // at its edge.
                .background(Brush.verticalGradient(0f to Color.Transparent, 0.28f to ground, 1f to ground))
                .navigationBarsPadding()
                .pageMargin()
                .padding(top = 16.dp, bottom = Nocturne.aboveNavBar),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            content = actions,
        )
    }
}

/** A column that fills the space above the pinned actions and scrolls. */
@Composable
fun BottomClearance(clearance: Dp) {
    Spacer(Modifier.height(clearance + 12.dp).width(1.dp))
}
