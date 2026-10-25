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
//  RESOLUTION. The pipeline expects 200 DPI on the card's short edge.
//  Registration searches +/-6% around that scale first, and only a page that
//  fails there gets the wider retries (size, tilt, a bent card -- see
//  register.ts). Every captured page is
//  laid out 8.5 inches wide and stored at 200 DPI (CapturedPages.pdf), so a
//  photo reaches the reader at the same scale as the chapter's scanner. On the
//  1.18 Imperial cards that read as well as the scan did (70 wrong of 728
//  boxes vs 71). Photos taken by hand in beach light have not been measured.
//
//  It was behind a BETA build from 1 September to 18 October 2026 and is an
//  ordinary button in every build since.
//
//  The frame below is drawn rather than live, and is doing real work as a
//  picture of what a usable page looks like: all four corners in, flat paper,
//  no shadow across the totals column. That is the advice that decides whether
//  a page registers.
//

import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// Photographing the cards instead of scanning them.
enum Camera {
    /// Whether to offer the camera at all. Checks for the camera permission at
    /// runtime: presenting the scanner without NSCameraUsageDescription does not
    /// fail politely, iOS terminates the app, so a build missing the key loses a
    /// button instead.
    static var offered: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil
    }
}

struct CaptureScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @ObservedObject private var drive = DriveFlow.shared
    @State private var scanning = false
    @State private var problem: String?
    /// How many photographed pages are being bound into a PDF, while they are.
    @State private var preparing: Int?
    @State private var showingTips = false
    /// Set by the tips' "Start scanning", so the camera opens once the sheet
    /// has gone: presenting it while the sheet is still dismissing drops it.
    @State private var scanAfterTips = false
    /// Camera rounds bound into PDFs and not read yet. The document camera
    /// stops at 24 pages, so a pile of more than twelve cards is several
    /// rounds, read together as one cleanup. See `CapturedPages.merge`.
    @State private var rounds: [Round] = []
    @State private var openingDriveLink = false

    private struct Round {
        let file: URL
        let pages: Int
    }

    private var roundPages: Int { rounds.reduce(0) { $0 + $1.pages } }

    var body: some View {
        ScreenBody(ground: Nocturne.captureGround, topPadding: Nocturne.safeTop) {
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(ChromeButtonStyle())
                Spacer()
                Text("Front and back, in card order")
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
                Text(Camera.offered ? "Photographed or scanned, front and back" : "One PDF per cleanup, scanned front-and-back")
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

                if !rounds.isEmpty {
                    Button(action: readRounds) {
                        HStack(spacing: 9) {
                            Image(systemName: Nocturne.Icon.spreadsheet)
                            Text("Read \(roundPages) \(roundPages == 1 ? "page" : "pages")")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(preparing != nil)
                }

                if Camera.offered {
                    // Primary until there is something to read; then reading
                    // is the next step and scanning more is the other one.
                    Group {
                        if rounds.isEmpty {
                            Button(action: openCamera) { cameraLabel }
                                .buttonStyle(PrimaryButtonStyle())
                        } else {
                            Button(action: openCamera) { cameraLabel }
                                .buttonStyle(SecondaryButtonStyle(minHeight: 52, size: 16))
                        }
                    }
                    .disabled(!CapturedPages.scanningAvailable || preparing != nil)
                }

                // Secondary beside the camera, primary when it is the only way
                // in. Two ButtonStyles are two types, so this is a branch rather
                // than a ternary.
                Group {
                    if Camera.offered {
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

                // Under the picker, and always secondary to it. The scanner's
                // PDF is the input every figure in HANDOFF.md was measured on
                // whichever way it reaches the phone; this is a shortcut to the
                // same file, not a second kind of scan. Absent entirely unless
                // the build was configured with a Google project -- see
                // DriveConfig, where that default is argued for.
                // A pasted link, no Google account: the chapter's scans are
                // shared "anyone with the link". See DrivePublic.
                Button {
                    openingDriveLink = true
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: Nocturne.Icon.drive)
                        Text("Choose from Google Drive")
                    }
                }
                .buttonStyle(SecondaryButtonStyle(minHeight: 52, size: 16))
                .sheet(isPresented: $openingDriveLink) {
                    DriveLinkSheet { pdf in
                        Task { await model.read(pdf: pdf) }
                    }
                }

                if case .downloading(let fraction, let name) = drive.stage {
                    // Downloading is not reading: the reading screen has its own
                    // progress and its own language, and showing that here would
                    // claim the scan was being read when it is still arriving.
                    VStack(spacing: 6) {
                        ProgressView(value: fraction)
                            .tint(Nocturne.accent)
                        Text("Downloading \(name) — \(Int(fraction * 100))%")
                            .font(Nocturne.Face.label(12))
                            .foregroundStyle(Nocturne.text(60))
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                if let preparing {
                    HStack(spacing: 8) {
                        ProgressView().tint(Nocturne.accent)
                        Text("Preparing \(preparing) \(preparing == 1 ? "picture" : "pictures")…")
                            .font(Nocturne.Face.label(12))
                            .foregroundStyle(Nocturne.text(60))
                    }
                } else if let problem = drive.problem ?? problem {
                    Text(problem)
                        .font(Nocturne.Face.label(12))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Nocturne.accent400)
                        .fixedSize(horizontal: false, vertical: true)
                } else if !rounds.isEmpty {
                    VStack(spacing: 6) {
                        Text(roundsHint)
                            .font(Nocturne.Face.label(12))
                            .lineSpacing(2)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(roundPages.isMultiple(of: 2) ? Nocturne.text(60) : Nocturne.accent400)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Throw these pictures away") { rounds = [] }
                            .buttonStyle(TextButtonStyle(size: 12))
                    }
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
        .sheet(isPresented: $showingTips, onDismiss: {
            if scanAfterTips {
                scanAfterTips = false
                scanning = true
            }
        }) {
            ScanTipsSheet {
                scanAfterTips = true
                showingTips = false
            }
        }
        .fullScreenCover(isPresented: $scanning) {
            DocumentScanner { scan in
                scanning = false
                guard scan.pageCount > 0 else { return }
                preparing = scan.pageCount
                problem = nil
                // Off the main thread: 100+ pages resampled one by one takes
                // seconds, and the screen should not freeze while it does.
                let pages = scan.pageCount
                Task.detached(priority: .userInitiated) {
                    let result: Result<URL, Error>
                    do { result = .success(try await CapturedPages.pdf(from: scan)) } catch { result = .failure(error) }
                    await MainActor.run {
                        preparing = nil
                        switch result {
                        case .success(let pdf):
                            // Not read yet: there may be more cards than one
                            // round of the camera holds.
                            rounds.append(Round(file: pdf, pages: pages))
                        case .failure(let error):
                            problem = "Those pictures could not be prepared: \(error.localizedDescription)"
                        }
                    }
                }
            } onCancel: {
                scanning = false
            }
            .ignoresSafeArea()
        }
    }

    private var cameraLabel: some View {
        HStack(spacing: 9) {
            Image(systemName: Nocturne.Icon.capture)
            Text(rounds.isEmpty ? "Take pictures of the cards" : "Scan more cards")
        }
    }

    private func openCamera() {
        if rounds.isEmpty {
            // Every time, on purpose: whoever is holding the phone may not be
            // whoever read it last time.
            showingTips = true
        } else {
            // The same person, a minute later, carrying on with the pile.
            scanning = true
        }
    }

    private func readRounds() {
        let files = rounds.map(\.file)
        preparing = roundPages
        problem = nil
        Task.detached(priority: .userInitiated) {
            let result = Result { try CapturedPages.merge(files) }
            await MainActor.run {
                preparing = nil
                switch result {
                case .success(let pdf):
                    rounds = []
                    Task { await model.read(pdf: pdf) }
                case .failure(let error):
                    problem = "Those pictures could not be put together: \(error.localizedDescription)"
                }
            }
        }
    }

    /// Where the pile stands between rounds of the camera.
    private var roundsHint: String {
        let pages = roundPages
        var text = "\(pages) \(pages == 1 ? "page" : "pages") so far"
        if rounds.count > 1 { text += ", in \(rounds.count) rounds" }
        text += ". The camera takes 24 pages (12 cards) at a time: scan the rest of the pile, carrying on in card order, then read them all together."
        if !pages.isMultiple(of: 2) {
            text += " That is an odd number of pages, so a card is missing a side."
        }
        return text
    }

    private var pickLabel: some View {
        HStack(spacing: 9) {
            Image(systemName: Nocturne.Icon.scan)
            Text("Choose a scanned PDF")
        }
    }

    /// What to say under the buttons.
    private var hint: String {
        guard Camera.offered else {
            return "Both sides of every card, in card order, from the chapter's scanner. The reading wants 200 DPI, which is what it produces."
        }
        if !CapturedPages.scanningAvailable {
            return "This device has no document scanner, so the cards have to come from a PDF. Scanned front-and-back, in card order."
        }
        return "Photograph each card front, then back, in card order. Lay it flat in good light, with no shadow across the totals column."
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
                    .padding(.vertical, 12)
                    .controlSurface(
                        RoundedRectangle(cornerRadius: Nocturne.Radius.glass, style: .continuous),
                        interactive: false,
                        fill: .clear
                    )
                    // Clear of the corner brackets. The advice is a card
                    // floating in the frame, and a card that lands ON the
                    // brackets reads as covering the very thing it is
                    // describing.
                    .padding(.horizontal, 26)
                    .padding(.bottom, 20)
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

// MARK: - How to scan

/// What decides whether a photographed page lines up, said before the camera
/// opens rather than after a page has been refused. Every point here is one
/// the registration measurements turned on: shadow and glare pale the printed
/// banners the alignment check reads, a page that is not flat bends the two
/// blocks apart, and a missing corner crops the grid.
enum ScanTips {
    static let items: [(icon: String, title: String, detail: String)] = [
        ("rectangle.portrait", "Flat, on a plain darker surface",
         "Press out any curl or fold. A table darker than the card helps the camera find its edges."),
        ("sun.max", "Even light, no shadow",
         "Keep your own shadow and your phone's off the card, especially the totals column. Turn the flash off if it leaves a glare."),
        ("viewfinder", "Straight above, all four corners in",
         "Hold the phone level over the middle of the card and wait for the outline to settle on its edges."),
        ("arrow.left.arrow.right", "Front, then back, card by card",
         "Keep the cards in order: the front of a card, then its back, then the next card."),
    ]
}

struct ScanTipsSheet: View {
    /// Shown as "Start scanning" when the camera opens next; nil for a sheet
    /// opened just to read, which closes with "Done".
    var onStart: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScreenBody(ground: Nocturne.captureGround, topPadding: 28) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Kicker(text: "Before you start", icon: Nocturne.Icon.capture)
                        .padding(.bottom, 8)
                    Text("How to scan the cards")
                        .font(Nocturne.Face.title(26))
                        .tracking(-0.26)
                        .foregroundStyle(Nocturne.text)
                        .padding(.bottom, 8)
                    Text("A page lines up, and is read, only when its printed banners show clearly. These four things decide that.")
                        .font(Nocturne.Face.body(13))
                        .lineSpacing(3)
                        .foregroundStyle(Nocturne.text(65))
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(ScanTips.items, id: \.title) { tip in
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: tip.icon)
                                .font(.system(size: 18))
                                .foregroundStyle(Nocturne.accent)
                                .frame(width: 26)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(tip.title)
                                    .font(Nocturne.Face.label(15, weight: .medium))
                                    .foregroundStyle(Nocturne.text)
                                Text(tip.detail)
                                    .font(Nocturne.Face.body(13))
                                    .lineSpacing(2.5)
                                    .foregroundStyle(Nocturne.text(62))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.top, 20)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .pageMargin()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 12) {
                    if let onStart {
                        Button(action: onStart) {
                            HStack(spacing: 9) {
                                Image(systemName: Nocturne.Icon.capture)
                                Text("Start scanning")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    } else {
                        Button("Done") { dismiss() }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                }
                .pageMargin()
                .padding(.top, 12)
                .padding(.bottom, 20)
            }
        }
        .presentationDragIndicator(.visible)
    }
}
