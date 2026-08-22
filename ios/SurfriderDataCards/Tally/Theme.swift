//
//  Nocturne, in Swift.
//
//  The design system's token sheet is `_ds/.../styles.css` in the design
//  project and the handoff lists every value the screens use. They are
//  transcribed here once and nothing else in the app writes a literal colour.
//
//  TWO SUBSTITUTIONS, both the ones the handoff asks for.
//
//  Type is Inter in the design and the system face here. The handoff's rule for
//  icons -- "on iOS, substitute the matching SF Symbol rather than bundling a
//  web font" -- is the same argument for the text: Inter and SF Pro are both
//  neutral grotesques at these sizes, and a bundled web font on iOS costs the
//  system's own optical sizing, Dynamic Type and the numeric variants. The
//  scale, the weights and the tracking below are the design's, exactly.
//
//  Icons are SF Symbols, named in `Icon` so the mapping from Phosphor is in one
//  place rather than spelled out at thirteen call sites.
//

import SwiftUI

enum Nocturne {

    // MARK: - Colour

    /// Page background.
    static let ground = Color(hex: 0x161826)
    /// Cards, inputs, keypad keys.
    static let surface = Color(hex: 0x232532)
    /// Never pure white.
    static let text = Color(hex: 0xE9E9ED)
    static let divider = text.opacity(0.16)

    /// Lines, marks, outlines -- never a flood.
    static let accent = Color(hex: 0x9184D9)
    /// Accent text at body size, where the accent itself would not carry.
    static let accent300 = Color(hex: 0xD2CEFD)
    /// Warnings.
    static let accent400 = Color(hex: 0xB5ABFC)
    /// Tinted borders.
    static let accent700 = Color(hex: 0x5D5294)
    /// Tag fills.
    static let accent800 = Color(hex: 0x423A6A)
    /// Tinted panel fills.
    static let accent900 = Color(hex: 0x2B2741)

    /// Progress track. The handoff names this "Neutral 800" and gives this hex;
    /// the token sheet has the same hex under `--color-neutral-900`. The hex is
    /// the thing being specified, so the hex is what is followed.
    static let track = Color(hex: 0x292B31)

    /// The capture screen darkens below the ground.
    static let captureGround = Color(hex: 0x0E0F18)

    /// Text at a fraction of full strength. The design expresses muted text as
    /// `color-mix(in srgb, text N%, transparent)`, which is this.
    static func text(_ percent: Double) -> Color { text.opacity(percent / 100) }

    // MARK: - Paper
    //
    // THE CROPS STAY ON WHITE ON PURPOSE. They are photographs of paper and the
    // job is reading faint pencil; inverting or dimming them costs contrast
    // exactly where it is scarcest, and misrepresents the card. They are framed
    // so they read as pictures rather than glare. Carried over verbatim from
    // the note at the top of src/style.css -- change it in both places or in
    // neither.

    enum Paper {
        static let fill = Color.white
        static let border = Color(hex: 0xC8CCD6)
        static let ruling = Color(hex: 0xE4E7EE)
        static let rule = Color(hex: 0xD5D9E2)
        static let ink = Color(hex: 0x26303C)
    }

    // MARK: - Spacing

    /// Horizontal page margin, everywhere.
    static let margin: CGFloat = 22
    /// The status bar overlays the content, so every screen starts below it.
    static let safeTop: CGFloat = 56
    /// Clears the home indicator.
    static let safeBottom: CGFloat = 46
    static let navBar: CGFloat = 44
    /// Nothing below this is a hit target.
    static let minTap: CGFloat = 44

    // MARK: - Radii

    enum Radius {
        static let viewfinder: CGFloat = 12
        static let draftCard: CGFloat = 10
        static let key: CGFloat = 9
        /// Inputs, buttons, panels, crops.
        static let base: CGFloat = 8
        static let thumb: CGFloat = 4
        static let pill: CGFloat = 999
    }

    // MARK: - Type
    //
    // Headings are weight 500 -- never heavier. Hierarchy is size and space.

    enum Face {
        /// Screen titles: 30 / 28 / 26.
        static func title(_ size: CGFloat) -> Font { .system(size: size, weight: .medium) }
        /// The item name on the checking screen.
        static let item = Font.system(size: 21, weight: .medium)
        /// The keypad entry display and the values in the card list.
        static func numeral(_ size: CGFloat) -> Font {
            .system(size: size, weight: .medium).monospacedDigit()
        }
        static func body(_ size: CGFloat = 13) -> Font { .system(size: size) }
        static func label(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
            .system(size: size, weight: weight)
        }
        static let cardTag = Font.system(size: 11, design: .monospaced)
    }

    // MARK: - Icons
    //
    // Phosphor regular in the design; the nearest SF Symbol here.

    enum Icon {
        static let add = "plus"                          // ph-plus
        static let back = "chevron.left"                 // ph-caret-left
        static let forward = "chevron.right"             // ph-caret-right
        static let capture = "camera"                    // ph-camera
        static let scan = "doc.text.viewfinder"          // capture, by PDF
        static let warning = "exclamationmark.triangle"  // ph-warning
        static let refused = "exclamationmark.circle"    // ph-warning-circle
        static let check = "checkmark"                   // ph-check
        static let pass = "checkmark.circle"             // ph-check-circle
        static let blocker = "xmark.circle"              // ph-x-circle
        static let privacy = "lock"                      // ph-lock-simple
        static let next = "arrow.right"                  // ph-arrow-right
        static let spreadsheet = "tablecells"            // ph-file-xls
        static let share = "square.and.arrow.up"         // ph-share-network
    }
}

// MARK: -

extension Color {
    /// `0x9184D9` reads like the design token it came from; `red:green:blue:`
    /// does not, and every one of these was transcribed from a hex string.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
