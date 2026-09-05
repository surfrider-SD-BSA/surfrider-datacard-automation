//
//  4 — Reading the pages
//
//  Honest progress, and the privacy promise where it counts.
//
//  The steps are the real ones. `processFile` on the web side rasterizes,
//  registers, cuts into cells and drops each page before the next is read, and
//  src/engine.ts does the same thing for the same reason -- memory discipline
//  matters more on a phone than it did in the browser. So the bar moves per
//  page, not on a timer.
//

import SwiftUI

struct ReadingScreen: View {
    @ObservedObject var model: TallyModel
    @ObservedObject var engine: Engine
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScreenBody(topPadding: 110) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Reading the cards")
                    .font(Nocturne.Face.title(26))
                    .tracking(-0.26)
                    .foregroundStyle(Nocturne.text)
                    .padding(.bottom, 8)

                Text("Nothing is uploaded. This all happens on the phone, and stops if you close the app.")
                    .font(Nocturne.Face.body(13))
                    .lineSpacing(3)
                    .foregroundStyle(Nocturne.text(60))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 26)

                ProgressLine(fraction: fraction)

                Text(caption)
                    .font(Nocturne.Face.body(13))
                    .foregroundStyle(Nocturne.text(62))
                    .padding(.top, 10)

                VStack(alignment: .leading, spacing: 14) {
                    ForEach(steps, id: \.label) { step in
                        HStack(alignment: .firstTextBaseline, spacing: 11) {
                            Group {
                                if step.done {
                                    Image(systemName: Nocturne.Icon.check)
                                        .font(.system(size: 11, weight: .semibold))
                                        .landing(on: step.done)
                                } else {
                                    Text("·")
                                }
                            }
                            .frame(width: 16, alignment: .leading)
                            .foregroundStyle(Nocturne.accent)

                            Text(step.label)
                                .font(Nocturne.Face.label(14))
                                .foregroundStyle(step.done ? Nocturne.text : Nocturne.text(45))

                            Spacer(minLength: 8)

                            Text(step.done ? step.note : "")
                                .font(Nocturne.Face.label(12))
                                .foregroundStyle(Nocturne.text(45))
                        }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .controlSurface(
                    RoundedRectangle(
                        cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base,
                        style: .continuous
                    ),
                    interactive: false,
                    stroke: Nocturne.divider
                )
                .padding(.top, 28)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .pageMargin()

            Spacer(minLength: 0)

            if let error = model.readingError {
                VStack(alignment: .leading, spacing: 12) {
                    Text("That scan could not be read.")
                        .font(Nocturne.Face.label(15, weight: .medium))
                        .foregroundStyle(Nocturne.text)
                    Text(error)
                        .font(Nocturne.Face.body(13))
                        .foregroundStyle(Nocturne.text(65))
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Try another scan") { dismiss() }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .pageMargin()
                .padding(.bottom, Nocturne.safeBottom)
            } else if let scan = model.scan {
                VStack(alignment: .leading, spacing: 12) {
                    Text(summary(scan))
                        .font(Nocturne.Face.body(13))
                        .lineSpacing(3)
                        .foregroundStyle(Nocturne.text(68))
                        .fixedSize(horizontal: false, vertical: true)

                    if model.refusedPages.isEmpty {
                        Button("Start checking") {
                            model.index = 0
                            model.syncEntryToCurrentCell()
                            model.path.append(.review)
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.cells.isEmpty)
                    } else {
                        Button("Look at that page first") { model.path.append(.refused) }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .pageMargin()
                .padding(.bottom, Nocturne.safeBottom)
            }
        }
        .navigationBarBackButtonHidden()
    }

    // MARK: -

    private var fraction: Double { model.scan != nil ? 1 : engine.progress.fraction }

    private var caption: String {
        if model.readingError != nil { return "Stopped." }
        if model.scan != nil { return "Done." }
        if let page = engine.progress.pageNumber, let total = engine.progress.total {
            return "Page \(page) of \(total) — nothing leaves the phone."
        }
        return "Opening the reference card — nothing leaves the phone."
    }

    private struct Step {
        let label: String
        let note: String
        let done: Bool
    }

    private var steps: [Step] {
        let scan = model.scan
        let aligned = scan.map { $0.pages.filter(\.trusted).count }
        let total = scan?.pageCount ?? engine.progress.total ?? 0
        let cells = model.allCells.count

        return [
            Step(
                label: "Pages read",
                note: "\(total) page\(total == 1 ? "" : "s")",
                done: scan != nil || (engine.progress.pageNumber ?? 0) > 0
            ),
            Step(
                label: "Pages squared up and aligned",
                note: aligned.map { "\($0) of \(total)" } ?? "",
                done: scan != nil
            ),
            Step(
                label: "Fronts and backs paired into cards",
                note: scan.map { "\($0.cards.count) card\($0.cards.count == 1 ? "" : "s")" } ?? "",
                done: scan != nil
            ),
            Step(
                label: "Looking for handwriting",
                note: "\(cells) cell\(cells == 1 ? "" : "s")",
                done: scan != nil
            ),
        ]
    }

    private func summary(_ scan: ScanResult) -> String {
        let cards = scan.cards.count
        let cells = model.allCells.count
        var text = "\(cards) card\(cards == 1 ? "" : "s"), \(cells) cell\(cells == 1 ? "" : "s") with something written in them."
        // The count found and the count to check are different numbers now, and
        // the gap is the cells this screen is the last chance to mention: they
        // are filled in, exported, and on no screen after this one.
        if model.takenAsReadCount > 0 {
            text += " \(model.takenAsReadCount) were read confidently and filled in for you; \(model.cells.count) left to check."
        }
        let refused = model.refusedPages.count
        if refused > 0 {
            text += " \(refused) page\(refused == 1 ? "" : "s") would not line up."
        }
        return text
    }
}
