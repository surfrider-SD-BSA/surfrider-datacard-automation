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
//  the scanner is the surer route. It is a warning, not a wall.
//
//  The frame below is drawn rather than live, and is doing real work as a
//  picture of what a usable page looks like: all four corners in, flat paper,
//  no shadow across the totals column. That is the advice that decides whether
//  a page registers.
//

import SwiftUI
import UniformTypeIdentifiers
import VisionKit

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

                Button {
                    scanning = true
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: Nocturne.Icon.capture)
                        Text("Take pictures of the cards")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!CapturedPages.scanningAvailable)

                Button {
                    picking = true
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: Nocturne.Icon.scan)
                        Text("Choose a scanned PDF")
                    }
                }
                .buttonStyle(SecondaryButtonStyle(minHeight: 52, size: 16))
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

    /// What to say under the two buttons.
    private var hint: String {
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
