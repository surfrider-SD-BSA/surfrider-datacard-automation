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

    var body: some View {
        ScreenBody {
            NavBar(back: "Checking") { dismiss() } trailing: {
                Button("Finish") { model.path.append(.finish) }
                    .buttonStyle(TextButtonStyle(size: 15))
                    .padding(8)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(model.event.shoreline.isEmpty ? "This cleanup" : model.event.shoreline)
                    .font(Nocturne.Face.title(26))
                    .tracking(-0.26)
                    .foregroundStyle(Nocturne.text)
                Text("\(model.checkedCount) of \(model.allCells.count) filled in · tap a row to look at the picture again")
                    .font(Nocturne.Face.body(13))
                    .foregroundStyle(Nocturne.text(55))
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

            Button("Make the spreadsheet") { model.path.append(.finish) }
                .buttonStyle(PrimaryButtonStyle())
                .pageMargin()
                .padding(.top, 16)
                .padding(.bottom, Nocturne.safeBottom)
                .bottomFade()
        }
        .navigationBarBackButtonHidden()
    }

    private func row(_ flat: FlatCell) -> some View {
        HStack(spacing: 12) {
            Text("C\(flat.key.card)")
                .font(Nocturne.Face.cardTag)
                .foregroundStyle(Nocturne.text(38))
                .frame(width: 26, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(flat.cell.itemName)
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
