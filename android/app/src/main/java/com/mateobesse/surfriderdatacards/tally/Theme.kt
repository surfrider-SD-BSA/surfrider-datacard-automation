//
//  Nocturne, in Kotlin.
//
//  The same tokens as ios/SurfriderDataCards/Tally/Theme.swift, transcribed
//  from the same handoff. Nothing else in the app writes a literal colour, so a
//  change to the design is a change here and in Theme.swift, or in neither.
//
//  THE SAME TWO SUBSTITUTIONS, for the same reason. Type is Inter in the design
//  and the system face here: the handoff's rule for icons -- use the platform's
//  own set rather than bundling a web font -- is the same argument for the
//  text, and the system face keeps font scaling and the numeric variants. The
//  scale, the weights and the tracking are the design's.
//
//  Icons are Material Symbols (outlined) in place of Phosphor, named in `Icon`
//  so the mapping is in one place, exactly as the SF Symbols are on iOS.
//
//  ONE PLATFORM DIFFERENCE, deliberately. There is no Liquid Glass here, so
//  every control is the flat Nocturne surface the design specifies -- the path
//  iOS takes below iOS 26. Glass.swift has no counterpart and needs none.
//

package com.mateobesse.surfriderdatacards.tally

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HighlightOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.SaveAlt
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Nocturne {

    // Colour

    /** Page background. */
    val ground = Color(0xFF161826)
    /** Cards, inputs, keypad keys. */
    val surface = Color(0xFF232532)
    /** Never pure white. */
    val text = Color(0xFFE9E9ED)
    val divider = text.copy(alpha = 0.16f)

    /** Lines, marks, outlines -- never a flood. */
    val accent = Color(0xFF9184D9)
    /** Accent text at body size, where the accent itself would not carry. */
    val accent300 = Color(0xFFD2CEFD)
    /** Warnings. */
    val accent400 = Color(0xFFB5ABFC)
    /** Tinted borders. */
    val accent700 = Color(0xFF5D5294)
    /** Tag fills. */
    val accent800 = Color(0xFF423A6A)
    /** Tinted panel fills. */
    val accent900 = Color(0xFF2B2741)

    /** Progress track. See the note on `track` in Theme.swift. */
    val track = Color(0xFF292B31)

    /** The capture screen darkens below the ground. */
    val captureGround = Color(0xFF0E0F18)

    /**
     * Text at a fraction of full strength. The design expresses muted text as
     * `color-mix(in srgb, text N%, transparent)`, which is this.
     */
    fun text(percent: Int): Color = text.copy(alpha = percent / 100f)

    // Paper
    //
    // THE CROPS STAY ON WHITE ON PURPOSE. They are photographs of paper and the
    // job is reading faint pencil; inverting or dimming them costs contrast
    // exactly where it is scarcest. Carried over verbatim from src/style.css
    // and Theme.swift -- change it in all three places or in none.

    object Paper {
        val fill = Color.White
        val border = Color(0xFFC8CCD6)
        val ruling = Color(0xFFE4E7EE)
        val rule = Color(0xFFD5D9E2)
        val ink = Color(0xFF26303C)
    }

    // Spacing

    /** Horizontal page margin, everywhere. */
    val margin = 22.dp
    /**
     * Below the status bar. iOS carries 56pt of top padding because the status
     * bar overlays its content; here the status bar's own inset is applied
     * first and this is what the design has left over.
     */
    val belowStatusBar = 6.dp
    /** Above the navigation bar, on top of its inset. */
    val aboveNavBar = 16.dp
    /**
     * Nothing below this is a hit target. 48dp rather than the design's 44pt:
     * that is Android's accessibility minimum, and the design's number was
     * iOS's. The nav bar is the same height for the same reason -- its back
     * affordance is the whole of it.
     */
    val minTap = 48.dp
    val navBar = minTap

    object Radius {
        val viewfinder = 12.dp
        val draftCard = 10.dp
        val key = 9.dp
        /** Inputs, buttons, panels, crops. */
        val base = 8.dp
        val thumb = 4.dp
    }

    // Type
    //
    // Headings are weight 500 -- never heavier. Hierarchy is size and space.

    object Face {
        /** Screen titles: 30 / 28 / 26. Tracking is -1% of the size, as specified. */
        fun title(size: Int) = TextStyle(
            fontSize = size.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-size / 100f).sp,
            lineHeight = (size * 1.15f).sp,
        )

        /** The item name on the checking screen. */
        val item = TextStyle(
            fontSize = 21.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = (-0.21).sp,
            lineHeight = 26.sp,
        )

        /** The keypad entry display and the values in the card list. */
        fun numeral(size: Int) = TextStyle(
            fontSize = size.sp,
            fontWeight = FontWeight.Medium,
            fontFeatureSettings = "tnum",
        )

        /** Body copy: 13 at line-height 1.5, per the handoff. */
        fun body(size: Int = 13, lineHeight: Float = 1.5f) = TextStyle(
            fontSize = size.sp,
            lineHeight = (size * lineHeight).sp,
        )

        fun label(size: Int, weight: FontWeight = FontWeight.Normal, tracking: TextUnit = TextUnit.Unspecified) =
            TextStyle(fontSize = size.sp, fontWeight = weight, letterSpacing = tracking)

        val cardTag = TextStyle(fontSize = 11.sp, fontFamily = FontFamily.Monospace)
    }

    // Icons
    //
    // Phosphor regular in the design; the nearest outlined Material Symbol here.

    object Icon {
        val add = Icons.Outlined.Add                                  // ph-plus
        val back = Icons.AutoMirrored.Outlined.KeyboardArrowLeft      // ph-caret-left
        val forward = Icons.AutoMirrored.Outlined.KeyboardArrowRight  // ph-caret-right
        val capture = Icons.Outlined.PhotoCamera                      // ph-camera
        val scan = Icons.Outlined.DocumentScanner                     // capture, by PDF
        val warning = Icons.Outlined.WarningAmber                     // ph-warning
        val refused = Icons.Outlined.ErrorOutline                     // ph-warning-circle
        val check = Icons.Outlined.Done                               // ph-check
        val pass = Icons.Outlined.CheckCircle                         // ph-check-circle
        val blocker = Icons.Outlined.HighlightOff                     // ph-x-circle
        val privacy = Icons.Outlined.Lock                             // ph-lock-simple
        val next = Icons.AutoMirrored.Outlined.ArrowForward           // ph-arrow-right
        val spreadsheet = Icons.Outlined.TableChart                   // ph-file-xls
        val share = Icons.Outlined.Share                              // ph-share-network
        val save = Icons.Outlined.SaveAlt                             // keeping a copy
        val backspace = Icons.AutoMirrored.Outlined.Backspace         // delete.left
    }
}
