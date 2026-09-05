//
//  Liquid Glass, where the system has it.
//
//  The app deploys to iOS 16 and builds against the iOS 26 SDK, so every glass
//  API here is behind `#available` and every one of them has a fallback that is
//  the Nocturne control exactly as it was. Nothing below changes what a screen
//  is made of -- it changes what the floating layer is made of.
//
//  WHERE GLASS GOES, AND WHERE IT DOES NOT. Apple's line is that glass is the
//  layer that floats above content: bars, keys, the chrome you reach for. It is
//  not the content itself. That line happens to be Nocturne's line too -- the
//  design's surfaces are flat with hairline borders precisely so the paper
//  crops are the only thing on screen with any depth. So:
//
//    glass      the pinned actions, the nav chrome, the keypad and its
//               display, the finish badge, and the panels that group a few
//               rows on the bare ground -- things that sit over something else
//    not glass  anything sitting INSIDE one of those: text fields, the draft
//               card, the tags. A lens over a lens is mud, and a field is
//               something to read and type in rather than something floating.
//               And above all not the crops: a photograph of pencil on paper
//               is the one thing here that must not be refracted or dimmed.
//
//  THE RADIUS GROWS ON GLASS AND ONLY ON GLASS. Nocturne's controls are 8pt and
//  glass at 8pt on a 52pt button looks like a mistake -- the specular edge has
//  no corner to travel around. iOS 26's own controls are capsules for the same
//  reason. So the glass path uses `Radius.glass` and the flat path is untouched
//  at `Radius.base`; the two never appear on the same device.
//

import SwiftUI

extension Nocturne {

    /// Whether the floating layer is drawn in glass.
    ///
    /// Asked in one place so a style's radius, its label colour and its ground
    /// can never disagree about which world they are in.
    static var hasGlass: Bool {
        if #available(iOS 26, *) { return true }
        return false
    }

    /// The tint carried by the affirmative action. Well under half strength:
    /// glass is a lens, and a tint heavy enough to read as a fill stops being
    /// one.
    static let glassTint = accent.opacity(0.34)

    enum Motion {
        /// The keypad's digit landing. Short enough that the number is there
        /// before the finger is off the key.
        static let entry = Animation.snappy(duration: 0.14)
    }
}

extension Nocturne.Radius {
    /// Buttons and bars, on the glass path only. See the note above.
    static let glass: CGFloat = 14
    /// Keypad keys, on the glass path only.
    static let glassKey: CGFloat = 16
}

// MARK: - The ground under a control

extension View {

    /// A control's ground: Liquid Glass on iOS 26, the flat Nocturne fill below
    /// it, and the same outline on both.
    ///
    /// - Parameters:
    ///   - shape: The control's outline. Also the glass's, so the specular edge
    ///     and the border are the same curve rather than two near-misses.
    ///   - tint: Colour lent to the glass. Ignored off the glass path.
    ///   - interactive: Let the glass answer a press itself -- it lifts and
    ///     brightens under the finger, which is a better pressed state than
    ///     anything drawn by hand.
    ///   - fill: The flat ground, used off the glass path only.
    ///   - stroke: The outline, drawn on both paths.
    @ViewBuilder
    func controlSurface(
        _ shape: some Shape,
        tint: Color? = nil,
        interactive: Bool = true,
        fill: Color = .clear,
        stroke: Color? = nil,
        lineWidth: CGFloat = 1
    ) -> some View {
        if #available(iOS 26, *) {
            glassEffect(Nocturne.glass(tint: tint, interactive: interactive), in: shape)
                .overlay { if let stroke { shape.stroke(stroke, lineWidth: lineWidth) } }
        } else {
            background(shape.fill(fill))
                .overlay { if let stroke { shape.stroke(stroke, lineWidth: lineWidth) } }
        }
    }
}

@available(iOS 26, *)
extension Nocturne {
    /// `Glass` is built rather than written out at each call site, because the
    /// tint and the interactive flag are both optional and chaining them
    /// conditionally in a ViewBuilder is four branches for one value.
    static func glass(tint: Color?, interactive: Bool) -> Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        return glass.interactive(interactive)
    }
}

// MARK: - Grouping

/// A `GlassEffectContainer` where there is one, and nothing at all where there
/// is not.
///
/// Glass shapes inside a container are sampled and lit together, so twelve
/// keypad keys refract one scene rather than twelve. Without it they each pick
/// up their own, and the grid reads as twelve unrelated panes.
struct GlassStack<Content: View>: View {
    var spacing: CGFloat?
    @ViewBuilder var content: Content

    var body: some View {
        if #available(iOS 26, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

// MARK: - Something for the glass to bend

/// The ambient light behind every screen, on the glass path only.
///
/// THIS IS NOT DECORATION, it is what makes the glass legible. Liquid Glass is
/// a lens: it lifts, bends and brightens whatever is behind it. Over a single
/// flat fill there is nothing to bend, so every glass control resolves to the
/// same grey rectangle and the effect reads as a slightly lighter box -- which
/// is exactly how the first pass of this looked.
///
/// So the ground gains three very soft glows off the Nocturne ramp. They are
/// far below the contrast floor for anything that has to be read -- the
/// brightest is 18% accent spread over 460pt -- and they sit under everything,
/// including the crops, which are opaque white and untouched by them. What they
/// buy is a gradient for the glass to travel across, so a key at the top of the
/// keypad and a key at the bottom are lit differently, which is the whole tell.
///
/// Off the glass path this does not exist and the ground is the flat `ground`
/// the design specifies, exactly as before.
struct Atmosphere: View {
    var body: some View {
        ZStack {
            glow(Nocturne.accent, 0.30, at: UnitPoint(x: 0.02, y: -0.02), radius: 300)
            glow(Nocturne.accent700, 0.34, at: UnitPoint(x: 1.04, y: 0.30), radius: 270)
            glow(Nocturne.accent, 0.22, at: UnitPoint(x: 0.5, y: 1.05), radius: 330)
        }
        .allowsHitTesting(false)
    }

    /// A glow with a steep falloff. A plain two-stop radial over a large radius
    /// lifts the whole screen into one flat wash -- the glass then has an even
    /// field behind it and is no better off than over the flat ground. The
    /// middle stop is what keeps the centre of the screen dark and the corners
    /// lit, which is the variation the lens needs.
    private func glow(_ color: Color, _ peak: Double, at center: UnitPoint, radius: CGFloat) -> some View {
        RadialGradient(
            stops: [
                .init(color: color.opacity(peak), location: 0),
                .init(color: color.opacity(peak * 0.28), location: 0.42),
                .init(color: .clear, location: 1),
            ],
            center: center, startRadius: 0, endRadius: radius
        )
    }
}

extension View {
    /// A screen's ground: the flat colour, plus the ambient glows where there
    /// is glass to catch them.
    @ViewBuilder
    func nocturneGround(_ color: Color) -> some View {
        if Nocturne.hasGlass {
            background {
                ZStack {
                    color
                    Atmosphere()
                }
                .ignoresSafeArea()
            }
        } else {
            background(color.ignoresSafeArea())
        }
    }
}

// MARK: - Chrome

/// Accent text in the nav bar: a glass pill on iOS 26, bare text below it.
///
/// Replaces `TextButtonStyle` at the two places that are chrome rather than an
/// inline action -- the back affordance and the one trailing button. The
/// padding is the style's rather than the caller's so the pill has something to
/// be a pill around.
struct ChromeButtonStyle: ButtonStyle {
    var size: CGFloat = 16
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Nocturne.Face.label(size))
            .foregroundStyle(Nocturne.accent)
            .padding(.horizontal, Nocturne.hasGlass ? 13 : 8)
            .padding(.vertical, 8)
            .contentShape(Capsule())
            .controlSurface(Capsule())
            .opacity(configuration.isPressed ? 0.6 : (isEnabled ? 1 : 0.45))
    }
}

// MARK: - The pinned action

extension View {

    /// The actions at the foot of a screen, floated over what is behind them.
    ///
    /// Attach with `.safeAreaInset(edge: .bottom)` so the list underneath keeps
    /// its full height and scrolls past rather than stopping short. On glass
    /// the scroll edge effect does the separating, so the ground fade -- which
    /// would be a second, flatter answer to the same problem -- is dropped.
    @ViewBuilder
    func pinnedActions(top: CGFloat = 16) -> some View {
        if Nocturne.hasGlass {
            pageMargin()
                // Taller than the flat path, and the extra is all fade. A row
                // has to have somewhere to dissolve BEFORE it reaches the
                // control: cut sharply at the button's own edge, a list reads
                // as clipped rather than as passing underneath.
                .padding(.top, top + 18)
                .padding(.bottom, Nocturne.safeBottom)
                // The fade is still here on the glass path. A floating bar
                // needs the list to dissolve beneath it rather than run to
                // the bezel, and the ground has to be SOLID by the time it
                // reaches the control: rows ghosting through the gap beside a
                // button, and again in the strip below it, is the one way a
                // floating bar reads as broken rather than as floating. So the
                // fade is spent above the button -- which still leaves the
                // glass a gradient to bend -- and everything from the button
                // down is ground.
                .background(
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: Nocturne.ground.opacity(0.55), location: 0.13),
                            .init(color: Nocturne.ground.opacity(0.95), location: 0.22),
                            .init(color: Nocturne.ground, location: 0.27),
                            .init(color: Nocturne.ground, location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
        } else {
            pageMargin()
                .padding(.top, top)
                .padding(.bottom, Nocturne.safeBottom)
                .bottomFade()
        }
    }

    /// The soft edge iOS 26 draws where content passes under a floating bar.
    @ViewBuilder
    func softScrollEdges() -> some View {
        if #available(iOS 26, *) {
            scrollEdgeEffectStyle(.soft, for: .bottom)
        } else {
            self
        }
    }
}

// MARK: - Motion

extension View {
    /// A symbol that lands rather than appears. iOS 17 and up; older systems
    /// simply get the symbol.
    @ViewBuilder
    func landing<V: Equatable>(on value: V) -> some View {
        if #available(iOS 17, *) {
            symbolEffect(.bounce, value: value)
        } else {
            self
        }
    }
}

// MARK: - Grouping content

/// A card the size of its content: glass where there is glass, the flat
/// outlined panel where there is not. For the small bounded groups -- the
/// finished cleanups, the reading steps, the export warnings -- never for the
/// long cell list, which is hundreds of rows and wants to stay cheap.
struct Panel<Content: View>: View {
    var padding: CGFloat = 0
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base, style: .continuous))
            .controlSurface(
                RoundedRectangle(
                    cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base,
                    style: .continuous
                ),
                interactive: false,
                stroke: Nocturne.divider
            )
    }
}
