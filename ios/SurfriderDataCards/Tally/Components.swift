//
//  The controls the eight screens are built from.
//
//  Everything here is the design's, and the pressed states are the part worth
//  keeping: the handoff is explicit that every control tints from the accent
//  ramp and that no browser -- or in this case system -- default is used. A
//  SwiftUI Button's default is a fade to 50% opacity, which is not the same
//  thing and reads as the control going away rather than being held.
//

import SwiftUI
import UIKit

// MARK: - Feedback

/// The part of a tap you feel before you can see anything.
///
/// Screen 6 is a keypad somebody works at for an hour, and a keypad with no
/// haptic reads as lag even when the digit lands in the same frame -- the thing
/// it is being compared against is the system keyboard, which has one. This is
/// the cheapest speed there is: nothing gets faster, but the tap stops feeling
/// like it went unanswered.
///
/// Prepared rather than fired cold. The Taptic Engine takes a beat to wake, and
/// the press that would land in it is the first of the session -- the one that
/// sets what the screen feels like.
enum Haptics {
    private static let key = UIImpactFeedbackGenerator(style: .light)
    private static let step = UIImpactFeedbackGenerator(style: .medium)

    static func prepare() {
        key.prepare()
        step.prepare()
    }

    /// A digit. Softer than the system keyboard's, because there are hundreds.
    static func tap() {
        key.impactOccurred(intensity: 0.7)
        key.prepare()
    }

    /// A value committed and the screen moving on.
    static func advance() {
        step.impactOccurred()
        step.prepare()
    }
}

// MARK: - Buttons

/// Outlined in the accent. The affirmative action on every screen.
///
/// On iOS 26 the outline stays and the inside becomes accent-tinted glass; the
/// label lightens to `accent300` because accent-on-accent-tint is the one place
/// the ramp does not carry. See Glass.swift.
struct PrimaryButtonStyle: ButtonStyle {
    var minHeight: CGFloat = 52
    var size: CGFloat = 16
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Nocturne.Face.label(size, weight: .medium))
            .foregroundStyle(Nocturne.hasGlass ? Nocturne.accent300 : Nocturne.accent)
            // Room inside the outline. Most of these stretch and never notice,
            // but the one that does not -- "Start fresh", beside a button that
            // does -- was drawing its label flush against both edges.
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .controlSurface(
                RoundedRectangle(
                    cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base,
                    style: .continuous
                ),
                tint: Nocturne.glassTint,
                fill: Nocturne.accent.opacity(configuration.isPressed ? 0.22 : 0),
                stroke: Nocturne.hasGlass ? Nocturne.accent.opacity(0.55) : Nocturne.accent
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

/// Outlined in the divider. The way out, or the lesser of two actions.
struct SecondaryButtonStyle: ButtonStyle {
    var minHeight: CGFloat = 50
    var size: CGFloat = 15
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Nocturne.Face.label(size, weight: .medium))
            .foregroundStyle(Nocturne.text)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .controlSurface(
                RoundedRectangle(
                    cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base,
                    style: .continuous
                ),
                fill: Nocturne.text.opacity(configuration.isPressed ? 0.14 : 0),
                stroke: Nocturne.divider
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

/// Accent text with no border: the nav bar, and the small inline actions.
struct TextButtonStyle: ButtonStyle {
    var size: CGFloat = 16
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Nocturne.Face.label(size))
            .foregroundStyle(Nocturne.accent)
            .opacity(configuration.isPressed ? 0.6 : (isEnabled ? 1 : 0.45))
    }
}

// MARK: - Chrome

/// The back affordance: a leading caret and the destination word, in accent.
///
/// Not a title bar. Screen titles are large and flush-left in the content, and
/// this sits above them in a 44pt bar of its own.
struct NavBar<Trailing: View>: View {
    let backLabel: String?
    let onBack: (() -> Void)?
    @ViewBuilder var trailing: Trailing

    init(back: String? = nil, onBack: (() -> Void)? = nil, @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.backLabel = back
        self.onBack = onBack
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: 0) {
            if let backLabel, let onBack {
                Button(action: onBack) {
                    HStack(spacing: 2) {
                        Image(systemName: Nocturne.Icon.back).font(.system(size: 15, weight: .medium))
                        Text(backLabel)
                    }
                }
                .buttonStyle(ChromeButtonStyle())
            }
            Spacer(minLength: 0)
            trailing
        }
        .frame(height: Nocturne.navBar)
        .padding(.horizontal, 14)
    }
}

/// Uppercase, tracked, accent. Sits above a title.
struct Kicker: View {
    let text: String
    var icon: String?
    var color: Color = Nocturne.accent

    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon).font(.system(size: 11)) }
            Text(text.uppercased())
                .font(Nocturne.Face.label(11))
                .tracking(1.2)
        }
        .foregroundStyle(color)
    }
}

/// A section label in the body: uppercase, tracked, text at 45%.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(Nocturne.Face.label(11))
            .tracking(1.1)
            .foregroundStyle(Nocturne.text(45))
    }
}

/// The progress bar. 6pt while reading, 4pt while checking.
struct ProgressLine: View {
    let fraction: Double
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Nocturne.track)
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Nocturne.accent700, Nocturne.accent, Nocturne.accent300],
                            startPoint: .leading, endPoint: .trailing
                        )
                    )
                    // The travelled part carries a little of its own light, so
                    // the bar is legible against the ambient ground rather than
                    // competing with it.
                    .shadow(color: Nocturne.accent.opacity(Nocturne.hasGlass ? 0.6 : 0), radius: 7)
                    .frame(width: max(0, min(1, fraction)) * geo.size.width)
            }
        }
        .frame(height: height)
        .animation(.easeOut(duration: 0.35), value: fraction)
    }
}

/// A freestanding rule, fading to transparent over its outer 48pt. A Nocturne
/// signature: box outlines and in-control separators stay solid, these do not.
struct FadingRule: View {
    var body: some View {
        GeometryReader { geo in
            let fade = min(48, geo.size.width / 3)
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: Nocturne.divider, location: fade / geo.size.width),
                    .init(color: Nocturne.divider, location: 1 - fade / geo.size.width),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading, endPoint: .trailing
            )
        }
        .frame(height: 1)
    }
}

/// A form field: 12pt label, optional suffix at 55%, and a 46pt input.
struct Field<Content: View>: View {
    let label: String
    var optional: Bool = false
    @ViewBuilder var content: Content

    private var fieldRadius: CGFloat {
        Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Text(label).foregroundStyle(Nocturne.text(70))
                if optional { Text("optional").foregroundStyle(Nocturne.text(55)) }
            }
            .font(Nocturne.Face.label(12))

            content
                .font(Nocturne.Face.label(16))
                .foregroundStyle(Nocturne.text)
                .tint(Nocturne.accent)
                .padding(.horizontal, 12)
                .frame(minHeight: 46)
                // NOT GLASS, on either path. A field is something to read and
                // type into, and a lens over the ground is the wrong answer to
                // "where does the text sit" -- it is the flat surface the
                // design specifies. Only the corner follows the glass world, so
                // a form and the button under it are the same family.
                .background(
                    RoundedRectangle(cornerRadius: fieldRadius, style: .continuous)
                        .fill(Nocturne.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: fieldRadius, style: .continuous)
                        .stroke(Nocturne.divider, lineWidth: 1)
                )
        }
    }
}

/// The accent-tinted panel: draft card, tally note, anything the accent frames
/// rather than floods.
struct TintedPanel<Content: View>: View {
    var radius: CGFloat = Nocturne.Radius.base
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(RoundedRectangle(cornerRadius: shape, style: .continuous).fill(Nocturne.accent900))
            .overlay(RoundedRectangle(cornerRadius: shape, style: .continuous).stroke(Nocturne.accent700, lineWidth: 1))
    }

    /// NOT GLASS. This panel is the one thing on screen that holds buttons of
    /// its own, and glass inside glass is mud -- the draft card came out a flat
    /// lavender block with two paler blocks sitting in it. It is also the place
    /// the design is most explicit that the accent FRAMES rather than floods.
    /// So the fill stays flat and the buttons in it keep the depth.
    private var shape: CGFloat {
        Nocturne.hasGlass ? max(radius, Nocturne.Radius.glass) : radius
    }
}

/// A row in a list, with the design's 1pt bottom divider and press tint.
struct RowButton<Content: View>: View {
    let action: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        Button(action: action) {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .overlay(alignment: .bottom) {
            Rectangle().fill(Nocturne.divider).frame(height: 1)
        }
    }
}

struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Nocturne.text.opacity(configuration.isPressed ? 0.05 : 0))
    }
}

// MARK: - Layout

extension View {
    /// The page margin, everywhere.
    func pageMargin() -> some View { padding(.horizontal, Nocturne.margin) }

    /// Pin an action over a fade to the ground, as screen 1 does.
    func bottomFade() -> some View {
        background(
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: Nocturne.ground, location: 0.28),
                    .init(color: Nocturne.ground, location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
        )
    }
}

/// Every screen's ground and safe padding, in one place.
struct ScreenBody<Content: View>: View {
    var ground: Color = Nocturne.ground
    var topPadding: CGFloat = Nocturne.safeTop
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.top, topPadding)
            .nocturneGround(ground)
    }
}

// MARK: - Tags

/// The small claim a control makes about itself: which reader filled a box in,
/// or that a path is unproven.
struct Tag: View {
    let text: String
    var size: CGFloat = 11
    var tracking: CGFloat = 0

    var body: some View {
        Text(text)
            .font(Nocturne.Face.label(size, weight: .medium))
            .tracking(tracking)
            .foregroundStyle(Nocturne.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            // Flat on both paths: a tag is always inside something -- a line of
            // body text, or a button's label -- and never on the bare ground,
            // so there is nothing behind it for a lens to find.
            .background(Capsule().fill(Nocturne.accent800))
    }
}
