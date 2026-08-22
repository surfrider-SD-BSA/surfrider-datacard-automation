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

// MARK: - Buttons

/// Outlined in the accent. The affirmative action on every screen.
struct PrimaryButtonStyle: ButtonStyle {
    var minHeight: CGFloat = 52
    var size: CGFloat = 16
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Nocturne.Face.label(size, weight: .medium))
            .foregroundStyle(Nocturne.accent)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .fill(Nocturne.accent.opacity(configuration.isPressed ? 0.22 : 0))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .stroke(Nocturne.accent, lineWidth: 1)
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
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .fill(Nocturne.text.opacity(configuration.isPressed ? 0.14 : 0))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .stroke(Nocturne.divider, lineWidth: 1)
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
                    .padding(8)
                }
                .buttonStyle(TextButtonStyle())
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
                    .fill(Nocturne.accent)
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
                .background(
                    RoundedRectangle(cornerRadius: Nocturne.Radius.base).fill(Nocturne.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Nocturne.Radius.base)
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
            .background(RoundedRectangle(cornerRadius: radius).fill(Nocturne.accent900))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Nocturne.accent700, lineWidth: 1))
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
            .background(ground.ignoresSafeArea())
    }
}
