//
//  5 — A page refused
//
//  Explain a refusal in the volunteer's language and offer the fix.
//
//  The threshold and the figure both come from `registerAgainstBestSide` in
//  src/lib/register.ts and are shown as they are. A generic failure tells
//  somebody the thing is broken; the real overlap tells them it was probably a
//  shadow, which is something they can do about.
//
//  "Retake page 7" photographs that one card side and reads the scan again
//  with it in place, so a refusal no longer means scanning the whole pile
//  again (Eric, South Ponto: "first side of card 2 was skipped because of a
//  scan error -- what is the behavior?").
//

import SwiftUI

struct RefusedScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss
    @State private var showingTips = false
    /// The page being photographed again, while the camera is up.
    @State private var retaking: Int?
    @State private var retakeProblem: String?

    var body: some View {
        ScreenBody {
            NavBar(back: "Back") { dismiss() } trailing: { HomeButton(model: model) }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Kicker(text: refusedLabel, icon: Nocturne.Icon.refused)
                        .padding(.bottom, 8)

                    Text(title)
                        .font(Nocturne.Face.title(26))
                        .tracking(-0.26)
                        .foregroundStyle(Nocturne.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 10)

                    Text("The card's printed banners and lines did not land where they should, so we do not know which box is which. A page that is a little off gives ordinary-looking numbers attached to the wrong items, and nothing later would catch it. So it is refused rather than cropped from.")
                        .font(Nocturne.Face.body(13))
                        .lineSpacing(3.5)
                        .foregroundStyle(Nocturne.text(65))
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(model.refusedPages, id: \.pageNumber) { page in
                        pageDetail(page).padding(.top, 20)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
                .pageMargin()
            }
            .softScrollEdges()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                actions
            }
        }
        .navigationBarBackButtonHidden()
    }

    // MARK: -

    private var canRetake: Bool {
        Camera.offered && CapturedPages.scanningAvailable && model.lastRead != nil
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if canRetake {
                ForEach(model.refusedPages.prefix(3), id: \.pageNumber) { page in
                    Button {
                        retaking = page.pageNumber
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: Nocturne.Icon.capture)
                            Text("Retake page \(page.pageNumber) (\(page.side))")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(minHeight: 50, size: 15))
                }
                if let retakeProblem {
                    Text(retakeProblem)
                        .font(Nocturne.Face.label(12))
                        .foregroundStyle(Nocturne.accent400)
                }
            }

            Button {
                // Back to the picker. A better scan of the same cards is
                // the only fix available until capture is switched on.
                model.path.removeAll { $0 == .reading || $0 == .refused }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: Nocturne.Icon.scan)
                    Text("Try a better scan")
                }
            }
            .buttonStyle(SecondaryButtonStyle(minHeight: 50, size: 15))

            // The same advice the camera opens with, for whoever skipped it.
            Button("How to get a good scan") { showingTips = true }
                .buttonStyle(TextButtonStyle())
                .frame(maxWidth: .infinity)

            Button("Leave it out and carry on") {
                model.index = 0
                model.syncEntryToCurrentCell()
                model.path.append(.review)
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.cells.isEmpty)

            Text(footnote)
                .font(Nocturne.Face.label(12))
                .lineSpacing(2)
                .foregroundStyle(Nocturne.text(42))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
        }
        .pinnedActions()
        .sheet(isPresented: $showingTips) { ScanTipsSheet() }
        .fullScreenCover(isPresented: Binding(get: { retaking != nil }, set: { if !$0 { retaking = nil } })) {
            DocumentScanner { scan in
                let page = retaking
                retaking = nil
                guard let page, let pdf = model.lastRead else { return }
                retakeProblem = nil
                Task.detached(priority: .userInitiated) {
                    let result = Result { try CapturedPages.replacing(page: page, in: pdf, with: scan) }
                    await MainActor.run {
                        switch result {
                        case .success(let fixed):
                            model.path.removeAll { $0 == .reading || $0 == .refused }
                            Task { await model.read(pdf: fixed) }
                        case .failure(let error):
                            retakeProblem = "That picture could not be used: \(error.localizedDescription)"
                        }
                    }
                }
            } onCancel: {
                retaking = nil
            }
            .ignoresSafeArea()
        }
    }

    private var refusedLabel: String {
        let n = model.refusedPages.count
        return "\(n) page\(n == 1 ? "" : "s") refused"
    }

    private var title: String {
        guard let first = model.refusedPages.first else { return "Every page lined up" }
        return model.refusedPages.count == 1
            ? "Page \(first.pageNumber) would not line up"
            : "\(model.refusedPages.count) pages would not line up"
    }

    private func pageDetail(_ page: ScanPage) -> some View {
        HStack(alignment: .top, spacing: 14) {
            // A stand-in for the page, not the page: a refused page is never
            // cropped from, so there is no picture of it to show.
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(Nocturne.text)
                GeometryReader { geo in
                    Path { path in
                        var y: CGFloat = 8
                        while y < geo.size.height - 8 {
                            path.move(to: CGPoint(x: 8, y: y))
                            path.addLine(to: CGPoint(x: geo.size.width - 8, y: y))
                            y += 9
                        }
                    }
                    .stroke(Color(hex: 0xC3C7D2), lineWidth: 1)
                }
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0.45),
                        .init(color: .black.opacity(0.22), location: 0.85),
                    ],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .frame(width: 96, height: 126)
            .rotationEffect(.degrees(-3))

            VStack(alignment: .leading, spacing: 8) {
                if page.bannerOverlap >= (model.scan?.minBannerOverlap ?? 0.75) {
                    // Refused by the sideways check, not the banners: quoting
                    // a banner figure above the bar would read as a mistake.
                    Text("Page \(page.pageNumber), read as a \(page.side). It lines up top to bottom but not side to side, so its boxes would be read from the wrong column.")
                } else {
                    Text("Page \(page.pageNumber), read as a \(page.side). Banner overlap \(overlap(page.bannerOverlap)) — below the \(overlap(model.scan?.minBannerOverlap ?? 0.75)) we trust.")
                }
                Text("Usually a shadow across one side, or a page that moved. Scanning it again in flatter light generally fixes it.")
            }
            .font(Nocturne.Face.body(13))
            .lineSpacing(3)
            .foregroundStyle(Nocturne.text(62))
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func overlap(_ value: Double) -> String { String(format: "%.2f", value) }

    private var footnote: String {
        let sides = model.refusedPages.map(\.side)
        let which = Set(sides).sorted().joined(separator: " and ")
        return "Leaving them out means those \(which) rows are blank in the spreadsheet. You can scan the cards again at any point before you send it."
    }
}
