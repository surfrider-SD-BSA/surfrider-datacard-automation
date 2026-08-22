//
//  6 — Checking a number  ← the screen that matters
//
//  Read one cell picture, type one number. This is where the hours go, and it
//  is the whole reason the phone is worth building for: one cell at a time on a
//  thumb-sized keypad, instead of hunting a 453-row list with a trackpad.
//
//  THE CROP STAYS ON WHITE. It is a photograph of paper and the job is reading
//  faint pencil; inverting or dimming it costs contrast exactly where it is
//  scarcest. It is framed so it reads as a picture rather than glare. Same note
//  as the top of src/style.css, and it is not a theming oversight.
//
//  THE BOX MAY ARRIVE FILLED. The tool reads what it can and puts it in, above
//  the gate in src/lib/prefill.ts, and roughly one filled box in five is wrong
//  at the current setting. That is defensible only because it is tagged as a
//  claim and sits directly under a picture of the handwriting -- so the tag is
//  not decoration, and neither is the order of the two.
//

import SwiftUI

struct ReviewScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss

    @State private var crop: UIImage?
    @State private var marks: UIImage?

    /// Show the whole row rather than the TOTAL box alone.
    ///
    /// On by default, and remembered. The desktop tool shows the box alone
    /// because its first build cropped the whole row and "the handwritten
    /// number was a few pixels across the far right of a very wide strip --
    /// unreadable". That is a fact about squeezing a 900px row into the width
    /// of a phone, not about the row being the wrong thing to show: the row is
    /// what tells you the ink in this box belongs to THIS item and not the one
    /// above it, which is the mistake a reviewer cannot otherwise catch.
    ///
    /// So the row is shown at a height the handwriting can be read at and
    /// scrolled sideways instead, parked on the TOTAL box. Nothing is squeezed
    /// and nothing has to be tapped.
    @AppStorage("tally.showWholeRow") private var showWholeRow = true

    var body: some View {
        ScreenBody {
            NavBar(back: "Back") { dismiss() } trailing: {
                Button("All cards") { model.path.append(.cards) }
                    .buttonStyle(TextButtonStyle(size: 15))
                    .padding(8)
            }

            if let flat = model.current {
                progressBlock(flat)
                itemBlock(flat)
                cropBlock(flat)
                if flat.cell.tallyOnly { tallyPanel }

                Spacer(minLength: 8)

                entryDisplay(flat)
                keypad
                footer(flat)
            } else {
                Spacer()
                Text("Nothing to check on this scan.")
                    .font(Nocturne.Face.body(14))
                    .foregroundStyle(Nocturne.text(55))
                Spacer()
            }
        }
        .navigationBarBackButtonHidden()
        .task(id: model.current?.key) { await loadCrops() }
        .onChange(of: showWholeRow) { _ in Task { await loadCrops() } }
    }

    // MARK: - Blocks

    private func progressBlock(_ flat: FlatCell) -> some View {
        VStack(spacing: 7) {
            HStack {
                Text("Cell \(model.index + 1) of \(model.cells.count)")
                Spacer()
                Text("Card \(flat.key.card) → column \(flat.column)")
            }
            .font(Nocturne.Face.label(12))
            .foregroundStyle(Nocturne.text(52))

            ProgressLine(
                fraction: model.cells.isEmpty ? 0 : Double(model.index + 1) / Double(model.cells.count),
                height: 4
            )
        }
        .pageMargin()
        .padding(.top, 2)
    }

    private func itemBlock(_ flat: FlatCell) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            // The names run long -- "Plastic Food Wrappers (candy, chip bags)"
            // -- so they wrap rather than truncate.
            Text(flat.cell.itemName)
                .font(Nocturne.Face.item)
                .tracking(-0.21)
                .lineSpacing(3)
                .foregroundStyle(Nocturne.text)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                Text(flat.cell.section)
                    .font(Nocturne.Face.label(12))
                    .foregroundStyle(Nocturne.accent300)

                // Which reader spoke, if one did. The reviewer is entitled to
                // know which claim they are being asked to check.
                if let prefill = model.untouched[flat.key] {
                    Text(prefill.tag)
                        .font(Nocturne.Face.label(11, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Nocturne.accent800))
                        .foregroundStyle(Nocturne.text)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .pageMargin()
        .padding(.top, 22)
    }

    private func cropBlock(_ flat: FlatCell) -> some View {
        VStack(spacing: 7) {
            ZStack {
                RoundedRectangle(cornerRadius: Nocturne.Radius.base).fill(Nocturne.Paper.fill)

                if let crop {
                    if showWholeRow {
                        // Full height, natural width, scrolled to the right --
                        // the TOTAL box is at the end of the row, so that is
                        // where it opens. Swipe left for the item's own
                        // caption and the tally space beside it.
                        ScrollViewReader { proxy in
                            ScrollView(.horizontal, showsIndicators: false) {
                                Image(uiImage: crop)
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .frame(height: 106)
                                    .id("row")
                            }
                            .onAppear { proxy.scrollTo("row", anchor: .trailing) }
                            .onChange(of: flat.key) { _ in proxy.scrollTo("row", anchor: .trailing) }
                        }
                        .padding(.vertical, 6)
                    } else {
                        Image(uiImage: crop)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .padding(6)
                    }
                } else {
                    ProgressView().tint(Nocturne.Paper.border)
                }
            }
            .frame(height: 118)
            .clipShape(RoundedRectangle(cornerRadius: Nocturne.Radius.base))
            .overlay(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .stroke(Nocturne.Paper.border, lineWidth: 1)
            )

            HStack {
                Text(showWholeRow
                     ? "Card \(flat.key.card), the whole row — swipe it"
                     : "The TOTAL box, enlarged 2.4×")
                Spacer()
                Button(showWholeRow ? "Just the box" : "Show the whole row") { showWholeRow.toggle() }
                    .buttonStyle(TextButtonStyle(size: 11))
            }
            .font(Nocturne.Face.label(11))
            .foregroundStyle(Nocturne.text(40))
        }
        .pageMargin()
        .padding(.top, 16)
    }

    /// A tally-only cell has no number to read. What the reviewer has to do is
    /// count the marks, so the marks are shown at the size they were drawn.
    private var tallyPanel: some View {
        TintedPanel {
            VStack(alignment: .leading, spacing: 9) {
                Text("Tally marks, no total written. Count them.")
                    .font(Nocturne.Face.label(12))
                    .foregroundStyle(Nocturne.accent300)

                ZStack {
                    RoundedRectangle(cornerRadius: 5).fill(Nocturne.Paper.fill)
                    if let marks {
                        Image(uiImage: marks)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .padding(6)
                    }
                }
                .frame(height: 52)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 13)
        }
        .pageMargin()
        .padding(.top, 12)
    }

    private func entryDisplay(_ flat: FlatCell) -> some View {
        Text(model.entry.isEmpty ? "—" : model.entry)
            .font(Nocturne.Face.numeral(40))
            .foregroundStyle(model.entry.isEmpty ? Nocturne.text(45) : Nocturne.text)
            .frame(minWidth: 120)
            .padding(.bottom, 6)
            .pageMargin()
    }

    private var keypad: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"], id: \.self) { key in
                Button { model.press(key) } label: {
                    Group {
                        if key == "<" {
                            Image(systemName: "delete.left").font(.system(size: 20))
                        } else {
                            Text(key).font(Nocturne.Face.label(23, weight: .medium))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 54)
                }
                .buttonStyle(KeypadKeyStyle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }

    private func footer(_ flat: FlatCell) -> some View {
        HStack(spacing: 10) {
            // A true zero. Blank is normal -- volunteers are unpaid and leave
            // things blank -- but a zero somebody looked at and a box nobody
            // reached are not the same fact.
            Button("Nothing there") { model.commit(0) }
                .buttonStyle(SecondaryButtonStyle())
                .frame(maxWidth: .infinity)

            Button {
                model.commit(Int(model.entry))
            } label: {
                HStack(spacing: 8) {
                    Text(model.index + 1 >= model.cells.count ? "Done" : "Next")
                    Image(systemName: Nocturne.Icon.next)
                }
            }
            .buttonStyle(PrimaryButtonStyle(minHeight: 50))
            .frame(maxWidth: .infinity)
            .layoutPriority(1)
            .disabled(model.entry.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 40)
    }

    // MARK: -

    private func loadCrops() async {
        guard let flat = model.current else { return }
        crop = nil
        marks = nil
        crop = try? await model.engine
            .crop(card: flat.key.card, row: flat.key.row, kind: showWholeRow ? "context" : "total")
            .image
        if flat.cell.tallyOnly {
            marks = try? await model.engine
                .crop(card: flat.key.card, row: flat.key.row, kind: "marks")
                .image
        }
    }
}

/// 54pt, and the pressed state tints from the accent ramp rather than fading.
private struct KeypadKeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Nocturne.text)
            .background(
                RoundedRectangle(cornerRadius: Nocturne.Radius.key)
                    .fill(configuration.isPressed ? Nocturne.accent.opacity(0.22) : Nocturne.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Nocturne.Radius.key)
                    .stroke(configuration.isPressed ? Nocturne.accent : Nocturne.divider, lineWidth: 1)
            )
    }
}
