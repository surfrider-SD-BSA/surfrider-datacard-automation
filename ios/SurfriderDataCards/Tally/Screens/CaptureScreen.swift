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
//  a plain camera, which is why this is not one. VisionKit's document scanner
//  finds the page's corners and rectifies the perspective before handing the
//  image over, so the pipeline gets a flat page. See DocumentScanner.swift.
//
//  WHAT IS STILL UNMEASURED is resolution: the pipeline expects 200 DPI on the
//  card's short edge, and whether a handheld capture clears that in beach light
//  has never been tested on a real card. The capture path preserves whatever
//  the camera gives rather than resampling it, and the screen says plainly that
//  the scanner is the surer route.
//
//  AS OF 1 SEPTEMBER 2026 IT IS A WALL, not a warning, and only for the App
//  Store. Shipping an unmeasured reading path to volunteers who cannot tell a
//  bad capture from a good one is how you get wrong numbers into a dataset
//  nobody re-checks. The button is behind `Beta.cameraCapture`, below; the code
//  underneath it is untouched and one build flag away.
//
//  The frame below is drawn rather than live, and is doing real work as a
//  picture of what a usable page looks like: all four corners in, flat paper,
//  no shadow across the totals column. That is the advice that decides whether
//  a page registers.
//

import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// What is here to be tried rather than relied on.
///
/// The camera is the only one so far, and it is here rather than deleted
/// because nothing is wrong with the code. VisionKit rectifies the page and the
/// pipeline receives a flat one; `CapturedPages.pdf` preserves the capture's
/// pixels instead of resampling them. Both of those took work and both are
/// right.
///
/// What has never been taken is the one number that decides whether the path is
/// worth having: the reading wants 200 DPI on the card's short edge, and
/// whether a handheld capture clears that in beach light has not been measured
/// on a real card. The design handoff calls that "the biggest open risk in the
/// whole concept".
///
/// So the answer is not to throw the path away and not to leave it sitting
/// beside the scanner as though the two were equal. It is gated, and it says
/// what it is.
///
/// **Measure it on a real card before this becomes an ordinary button.**
enum Beta {
    /// Photographing the cards instead of scanning them.
    ///
    /// A compilation condition rather than a constant, so that turning it on is
    /// something a build has to ask for and not something a person has to
    /// remember to turn off. An App Store archive cannot pick it up by
    /// forgetting something:
    ///
    ///     BETA=1 ios/testflight.sh
    ///
    /// Use the script, not a bare `SWIFT_ACTIVE_COMPILATION_CONDITIONS=BETA`.
    /// The flag alone gives a build with the button still hidden, because the
    /// camera permission it needs is injected by the script and by nothing
    /// else. NSCameraUsageDescription ships ABSENT: the store build never opens
    /// a camera, and a reviewer who cannot find the feature a permission string
    /// is for is a reviewer who writes to ask.
    ///
    /// Hence the runtime check, which is not paranoia about a key that is
    /// normally there -- it is normally not. Presenting the scanner without it
    /// does not fail politely; iOS terminates the app. A BETA build that missed
    /// the injection loses a button here instead of dying mid-cleanup in a
    /// volunteer's hand.
    static var cameraCapture: Bool {
        #if BETA
        return Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil
        #else
        return false
        #endif
    }
}

struct CaptureScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var scanning = false
    @State private var problem: String?

    var body: some View {
        ScreenBody(ground: Nocturne.captureGround, topPadding: Nocturne.safeTop) {
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(TextButtonStyle())
                Spacer()
                Text("A scan, front and back, in card order")
                    .font(Nocturne.Face.label(13))
                    .foregroundStyle(Nocturne.text(60))
            }
            .frame(height: Nocturne.navBar)
            .padding(.horizontal, 14)

            VStack(spacing: 4) {
                Text("The cards")
                    .font(Nocturne.Face.title(22))
                    .tracking(-0.22)
                    .foregroundStyle(Nocturne.text)
                Text("One PDF per cleanup, scanned front-and-back")
                    .font(Nocturne.Face.body(13))
                    .foregroundStyle(Nocturne.accent300)
            }
            .padding(.top, 26)
            .padding(.bottom, 10)

            viewfinder
                .aspectRatio(3.0 / 4.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: Nocturne.Radius.viewfinder))
                .pageMargin()
                .padding(.top, 6)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                if let waiting = model.pendingPDF {
                    Button {
                        model.pendingPDF = nil
                        Task { await model.read(pdf: waiting) }
                    } label: {
                        HStack(spacing: 9) {
                            Image(systemName: Nocturne.Icon.spreadsheet)
                            Text("Read \(waiting.lastPathComponent)")
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }

                if Beta.cameraCapture {
                    Button {
                        scanning = true
                    } label: {
                        HStack(spacing: 9) {
                            Image(systemName: Nocturne.Icon.capture)
                            Text("Take pictures of the cards")
                            // Said on the control itself, not only in the hint
                            // underneath. Somebody choosing between two buttons
                            // is entitled to know one of them is unproven at the
                            // moment they choose.
                            Text("BETA")
                                .font(Nocturne.Face.label(10, weight: .medium))
                                .tracking(0.8)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Nocturne.accent800))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!CapturedPages.scanningAvailable)
                }

                // Secondary beside the camera, primary when it is the only way
                // in. Two ButtonStyles are two types, so this is a branch rather
                // than a ternary.
                Group {
                    if Beta.cameraCapture {
                        Button { picking = true } label: { pickLabel }
                            .buttonStyle(SecondaryButtonStyle(minHeight: 52, size: 16))
                    } else {
                        Button { picking = true } label: { pickLabel }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                }
                .sheet(isPresented: $picking) {
                    PDFPicker { url in
                        picking = false
                        Task { await model.read(pdf: url) }
                    } onCancel: {
                        picking = false
                    }
                    .ignoresSafeArea()
                }

                if let problem {
                    Text(problem)
                        .font(Nocturne.Face.label(12))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Nocturne.accent400)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(hint)
                        .font(Nocturne.Face.label(12))
                        .lineSpacing(2)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Nocturne.text(42))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .pageMargin()
            .padding(.top, 14)
            .padding(.bottom, Nocturne.safeBottom)
        }
        .navigationBarBackButtonHidden()
        .fullScreenCover(isPresented: $scanning) {
            DocumentScanner { pages in
                scanning = false
                guard !pages.isEmpty else { return }
                do {
                    let pdf = try CapturedPages.pdf(from: pages)
                    Task { await model.read(pdf: pdf) }
                } catch {
                    problem = "Those pictures could not be prepared: \(error.localizedDescription)"
                }
            } onCancel: {
                scanning = false
            }
            .ignoresSafeArea()
        }
    }

    private var pickLabel: some View {
        HStack(spacing: 9) {
            Image(systemName: Nocturne.Icon.scan)
            Text("Choose a scanned PDF")
        }
    }

    /// What to say under the buttons.
    private var hint: String {
        guard Beta.cameraCapture else {
            return "Both sides of every card, in card order, from the chapter's scanner. The reading wants 200 DPI, which is what it produces."
        }
        if !CapturedPages.scanningAvailable {
            return "This device has no document scanner, so the cards have to come from a PDF. Scanned front-and-back, in card order."
        }
        return "Photograph both sides of every card, in order. The scanner's PDF is the surer route where you have one — the reading wants 200 DPI, and a phone capture has not been measured against that yet."
    }

    // MARK: - The card guide

    private var viewfinder: some View {
        ZStack {
            RadialGradient(
                colors: [Color(hex: 0x1D2030), Color(hex: 0x0B0C14)],
                center: UnitPoint(x: 0.5, y: 0.2), startRadius: 0, endRadius: 320
            )

            // Faint ruling, to suggest paper.
            GeometryReader { geo in
                Path { path in
                    var y: CGFloat = 0
                    while y < geo.size.height {
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: geo.size.width, y: y))
                        y += 26
                    }
                }
                .stroke(Nocturne.text.opacity(0.05), lineWidth: 1)
            }
            .padding(22)

            RoundedRectangle(cornerRadius: Nocturne.Radius.thumb)
                .strokeBorder(
                    Nocturne.accent.opacity(0.55),
                    style: StrokeStyle(lineWidth: 1, dash: [5, 4])
                )
                .padding(22)

            corners

            VStack {
                Spacer()
                Text("All four corners inside the frame. Flat paper, no shadow across the totals column.")
                    .font(Nocturne.Face.label(12))
                    .lineSpacing(2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Nocturne.text(72))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity)
                    .background(
                        LinearGradient(
                            colors: [.clear, Color(hex: 0x0B0C14).opacity(0.92)],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
            }
        }
    }

    private var corners: some View {
        GeometryReader { geo in
            let arm: CGFloat = 34
            let inset: CGFloat = 12
            ForEach(Corner.allCases, id: \.self) { corner in
                CornerBracket(corner: corner, arm: arm)
                    .stroke(Nocturne.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .frame(width: arm, height: arm)
                    .position(
                        x: corner.isLeading ? inset + arm / 2 : geo.size.width - inset - arm / 2,
                        y: corner.isTop ? inset + arm / 2 : geo.size.height - inset - arm / 2
                    )
            }
        }
    }

    private enum Corner: CaseIterable {
        case topLeading, topTrailing, bottomLeading, bottomTrailing
        var isTop: Bool { self == .topLeading || self == .topTrailing }
        var isLeading: Bool { self == .topLeading || self == .bottomLeading }
    }

    private struct CornerBracket: Shape {
        let corner: Corner
        let arm: CGFloat

        func path(in rect: CGRect) -> Path {
            var path = Path()
            let x = corner.isLeading ? rect.minX : rect.maxX
            let y = corner.isTop ? rect.minY : rect.maxY
            path.move(to: CGPoint(x: corner.isLeading ? rect.maxX : rect.minX, y: y))
            path.addLine(to: CGPoint(x: x, y: y))
            path.addLine(to: CGPoint(x: x, y: corner.isTop ? rect.maxY : rect.minY))
            return path
        }
    }
}
