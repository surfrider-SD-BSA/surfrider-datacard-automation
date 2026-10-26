//
//  7 — Everything typed
//
//  See the whole event, jump back to any picture.
//
//  A row's value is an em-dash until somebody puts something there, and "0" is
//  a different thing from an em-dash: blank is a real answer and goes to the
//  spreadsheet as nothing, not as zero.
//

import SwiftUI

struct CardsScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss
    @State private var adding = false
    @State private var addProblem: String?

    var body: some View {
        ScreenBody {
            NavBar(back: "Checking") { dismiss() } trailing: {
                HomeButton(model: model)
                Button("Finish") { model.path.append(.finish) }
                    .buttonStyle(ChromeButtonStyle(size: 15))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(model.event.shoreline.isEmpty ? "This cleanup" : model.event.shoreline)
                    .font(Nocturne.Face.title(26))
                    .tracking(-0.26)
                    .foregroundStyle(Nocturne.text)
                Text("\(model.checkedCount) of \(model.allCells.count) filled in · tap a row to look at the picture again")
                    .font(Nocturne.Face.body(13))
                    .foregroundStyle(Nocturne.text(55))
                    .contentTransition(.numericText())
                    .animation(Nocturne.Motion.entry, value: model.checkedCount)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .pageMargin()
            .padding(.top, 6)
            .padding(.bottom, 14)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(model.cells) { flat in
                        RowButton { model.jump(to: flat.key) } content: {
                            row(flat)
                        }
                    }

                    if Camera.offered, CapturedPages.scanningAvailable, model.canAddCards {
                        Button { adding = true } label: {
                            HStack(spacing: 9) {
                                Image(systemName: Nocturne.Icon.capture)
                                Text("Add more cards")
                            }
                        }
                        .buttonStyle(SecondaryButtonStyle(minHeight: 48, size: 15))
                        .pageMargin()
                        .padding(.top, 16)
                        if let addProblem {
                            Text(addProblem)
                                .font(Nocturne.Face.label(12))
                                .foregroundStyle(Nocturne.accent400)
                                .pageMargin()
                        }
                    }

                    Text(blankNote)
                        .font(Nocturne.Face.label(12))
                        .lineSpacing(2)
                        .foregroundStyle(Nocturne.text(40))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .pageMargin()
                        .padding(.top, 16)
                }
            }
            .softScrollEdges()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Button("Make the spreadsheet") { model.path.append(.finish) }
                    .buttonStyle(PrimaryButtonStyle())
                    .pinnedActions()
            }
        }
        .navigationBarBackButtonHidden()
        .fullScreenCover(isPresented: $adding) {
            DocumentScanner { scan in
                adding = false
                guard scan.pageCount > 0, let read = model.lastRead else { return }
                addProblem = nil
                Task.detached(priority: .userInitiated) {
                    let result: Result<URL, Error>
                    do { result = .success(try CapturedPages.merge([read, try await CapturedPages.pdf(from: scan)])) } catch { result = .failure(error) }
                    await MainActor.run {
                        switch result {
                        case .success(let pdf):
                            Task {
                                let kept = await model.addCards(from: pdf)
                                if !kept, model.readingError == nil {
                                    addProblem = "The new pages changed how the earlier ones pair into cards, so the checking starts again from the top."
                                }
                            }
                        case .failure(let error):
                            addProblem = "Those pictures could not be added: \(error.localizedDescription)"
                        }
                    }
                }
            } onCancel: {
                adding = false
            }
            .ignoresSafeArea()
        }
    }

    private func row(_ flat: FlatCell) -> some View {
        HStack(spacing: 12) {
            Text("C\(flat.key.card)")
                .font(Nocturne.Face.cardTag)
                .foregroundStyle(Nocturne.text(38))
                .frame(width: 26, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(flat.cell.label)
                    .font(Nocturne.Face.label(14))
                    .foregroundStyle(Nocturne.text)
                    .lineLimit(2)
                Text(flat.cell.section)
                    .font(Nocturne.Face.label(11))
                    .foregroundStyle(Nocturne.text(45))
            }

            Spacer(minLength: 8)

            Text(model.values[flat.key].map(String.init) ?? "—")
                .font(Nocturne.Face.numeral(19))
                // A value the tool put there and nobody has looked at is drawn
                // in the accent, exactly as `.cell.prefilled` does on the web
                // side. Scrolling past a few hundred of these, a machine
                // reading that looks like a typed one is how it gets exported
                // as though somebody had read it off the card.
                .foregroundStyle(tone(flat))
        }
        .padding(.vertical, 12)
        .pageMargin()
    }

    private func tone(_ flat: FlatCell) -> Color {
        if model.untouched[flat.key] != nil { return Nocturne.accent }
        return model.values[flat.key] == nil ? Nocturne.text(45) : Nocturne.text
    }

    private var blankNote: String {
        let untouched = model.untouched.count
        var text = "Rows left blank on the paper go to the spreadsheet as nothing, not as zero."
        if untouched > 0 {
            text += " \(untouched) value\(untouched == 1 ? " is" : "s are") still as the tool read \(untouched == 1 ? "it" : "them") — those are in accent above."
        }
        return text
    }
}
