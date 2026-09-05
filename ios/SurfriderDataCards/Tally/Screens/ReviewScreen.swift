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

    /// Bumped when a crop lands, to bring the body back to the cache.
    ///
    /// The pictures are NOT held in `@State` here, and that is the point. This
    /// screen re-renders with the next cell's name and number the instant the
    /// index moves, while its crops are still being looked up -- and three
    /// images left over from the previous cell would be shown underneath that
    /// name for a frame. At the rate this screen is worked, that flicker is
    /// precisely the thing being fixed. So the body reads the cache, keyed by
    /// the cell it is drawing, and this only tells it to look again.
    @State private var revision = 0

    /// Show the whole row as a strip beneath the box.
    ///
    /// On by default, and remembered. The desktop tool shows the box alone
    /// because its first build cropped the whole row and "the handwritten
    /// number was a few pixels across the far right of a very wide strip --
    /// unreadable". That is a fact about squeezing a 900px row into the width
    /// of a phone, not about the row being the wrong thing to show: the row is
    /// what tells you the ink in this box belongs to THIS item and not the one
    /// above it, which is the mistake a reviewer cannot otherwise catch.
    ///
    /// So the row does not REPLACE the box, which was the first attempt at this
    /// and was wrong twice over: the box is the thing being read, and a row
    /// squeezed to the width of a phone is unreadable anyway. It is added
    /// beneath the box as its own strip, at a height the handwriting survives,
    /// scrolled sideways and parked on the TOTAL box. Nothing is squeezed,
    /// nothing has to be tapped, and the box cannot go missing.
    @AppStorage("tally.showWholeRow") private var showWholeRow = true

    var body: some View {
        ScreenBody {
            NavBar(back: "Back") { dismiss() } trailing: {
                Button("All cards") { model.path.append(.cards) }
                    .buttonStyle(ChromeButtonStyle(size: 15))
            }

            if let flat = model.current {
                progressBlock(flat)
                itemBlock(flat)
                cropBlock(flat)
                if flat.cell.tallyOnly { tallyPanel(flat) }

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
        .onAppear { Haptics.prepare() }
        .task(id: model.current?.key) { await loadCrops() }
        .onChange(of: showWholeRow) { _ in Task { await loadCrops() } }
    }

    // MARK: - Blocks

    private func progressBlock(_ flat: FlatCell) -> some View {
        VStack(spacing: 7) {
            HStack {
                Text("Cell \(model.index + 1) of \(model.cells.count)")
                    .contentTransition(.numericText())
                Spacer()
                Text("Card \(flat.key.card) → column \(flat.column)")
            }
            .font(Nocturne.Face.label(12))
            .foregroundStyle(Nocturne.text(52))
            .animation(Nocturne.Motion.entry, value: model.index)

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
                    Tag(text: prefill.tag)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .pageMargin()
        .padding(.top, 22)
    }

    private func cropBlock(_ flat: FlatCell) -> some View {
        VStack(spacing: 7) {
            // The TOTAL box, enlarged. This is the picture the number is read
            // from and it is never traded for anything else.
            paper(height: 118) {
                if let crop = picture(flat, "total") {
                    Image(uiImage: crop)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .padding(6)
                } else {
                    ProgressView().tint(Nocturne.Paper.border)
                }
            }

            // The row it sits in, as a strip. Context for whether this ink
            // belongs to THIS item -- the one mistake nothing downstream can
            // catch -- without costing the box any size.
            if showWholeRow, let row = picture(flat, "context") {
                paper(height: 42) {
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal, showsIndicators: false) {
                            // The width is computed rather than inferred. A
                            // resizable image with `.fit` inside a horizontal
                            // ScrollView is proposed an unbounded width, and
                            // resolves to nothing -- which is how this shipped
                            // once as an empty white card.
                            Image(uiImage: row)
                                .resizable()
                                .frame(width: stripWidth(row), height: 34)
                                .id("row")
                        }
                        .onAppear { proxy.scrollTo("row", anchor: .trailing) }
                        .onChange(of: flat.key) { _ in proxy.scrollTo("row", anchor: .trailing) }
                    }
                    .padding(.vertical, 4)
                }
            }

            HStack {
                Text(showWholeRow ? "The TOTAL box at 2.4×, over its row — swipe it" : "The TOTAL box, enlarged 2.4×")
                Spacer()
                Button(showWholeRow ? "Hide the row" : "Show the whole row") { showWholeRow.toggle() }
                    .buttonStyle(TextButtonStyle(size: 11))
            }
            .font(Nocturne.Face.label(11))
            .foregroundStyle(Nocturne.text(40))
        }
        .pageMargin()
        .padding(.top, 16)
    }

    /// Scanned crops sit on white. See the note at the top of this file.
    private func paper<Content: View>(height: CGFloat, @ViewBuilder content: () -> Content) -> some View {
        ZStack { RoundedRectangle(cornerRadius: Nocturne.Radius.base).fill(Nocturne.Paper.fill); content() }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: Nocturne.Radius.base))
            .overlay(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .stroke(Nocturne.Paper.border, lineWidth: 1)
            )
            // The picture is the one opaque thing on the screen, and a cast
            // shadow is what says so: it sits ABOVE the glass layer rather than
            // among it. The crop itself is untouched -- see the note at the top
            // of this file.
            .shadow(color: .black.opacity(Nocturne.hasGlass ? 0.45 : 0), radius: 16, y: 7)
    }

    private func stripWidth(_ image: UIImage) -> CGFloat {
        guard image.size.height > 0 else { return 0 }
        return 34 * (image.size.width / image.size.height)
    }

    /// A tally-only cell has no number to read. What the reviewer has to do is
    /// count the marks, so the marks are shown at the size they were drawn.
    private func tallyPanel(_ flat: FlatCell) -> some View {
        TintedPanel {
            VStack(alignment: .leading, spacing: 9) {
                Text("Tally marks, no total written. Count them.")
                    .font(Nocturne.Face.label(12))
                    .foregroundStyle(Nocturne.accent300)

                ZStack {
                    RoundedRectangle(cornerRadius: 5).fill(Nocturne.Paper.fill)
                    if let marks = picture(flat, "marks") {
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

    /// The digits roll rather than cut. `numericText` is a per-glyph morph, so
    /// a 7 becoming a 74 slides one digit in instead of redrawing the number --
    /// which is what the keypad is actually doing. Short enough (0.14s) that
    /// the digit is settled before the finger is off the key; the haptic still
    /// fires first, and nothing waits on this.
    private func entryDisplay(_ flat: FlatCell) -> some View {
        Text(model.entry.isEmpty ? "—" : model.entry)
            .font(Nocturne.Face.numeral(40))
            .foregroundStyle(model.entry.isEmpty ? Nocturne.text(45) : Nocturne.text)
            .contentTransition(.numericText())
            .animation(Nocturne.Motion.entry, value: model.entry)
            .frame(maxWidth: .infinity, minHeight: 62)
            // The number sits on its own plate above the keys, the way a
            // calculator's display does -- one more thing the glass has to
            // separate, and the reason the digits read at 40pt over the
            // ambient ground.
            .controlSurface(
                RoundedRectangle(cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glass : Nocturne.Radius.base, style: .continuous),
                interactive: false,
                stroke: Nocturne.hasGlass ? Nocturne.divider : nil
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
    }

    /// Twelve keys in one glass container, so they are lit and sampled as one
    /// keypad rather than twelve separate panes. Off the glass path the
    /// container is nothing at all and the keys are the flat Nocturne surface
    /// they always were.
    private var keypad: some View {
        GlassStack(spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"], id: \.self) { key in
                    Button {
                        // Before the model, not after: the felt half of the tap
                        // is the half that must not wait on anything.
                        Haptics.tap()
                        model.press(key)
                    } label: {
                        Group {
                            if key == "<" {
                                Image(systemName: "delete.left").font(.system(size: 20))
                            } else {
                                Text(key).font(Nocturne.Face.label(23, weight: .medium))
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .buttonStyle(KeypadKeyStyle(clearing: key == "C" || key == "<"))
                }
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
            // Both styles already stretch, so the row splits evenly.
            //
            // "Nothing there" was drawing at zero width. `layoutPriority(1)` on
            // Next had the HStack offer it the whole remaining row first, and a
            // child with `maxWidth: .infinity` takes everything it is offered --
            // so there was nothing left. Neither button needs an outer frame;
            // the two ButtonStyles stretch on their own.
            Button("Nothing there") {
                Haptics.advance()
                model.commit(0)
            }
            .buttonStyle(SecondaryButtonStyle())

            Button {
                Haptics.advance()
                model.commit(Int(model.entry))
            } label: {
                HStack(spacing: 8) {
                    Text(model.index + 1 >= model.cells.count ? "Done" : "Next")
                    Image(systemName: Nocturne.Icon.next)
                }
            }
            .buttonStyle(PrimaryButtonStyle(minHeight: 50))
            .disabled(model.entry.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 40)
    }

    // MARK: -

    /// Whatever the cache holds for this cell right now. Never a wait, and
    /// never a picture belonging to a different cell.
    private func picture(_ flat: FlatCell, _ kind: String) -> UIImage? {
        model.crops.cached(.init(card: flat.key.card, row: flat.key.row, kind: kind))
    }

    private func loadCrops() async {
        guard let flat = model.current else { return }
        let cache = model.crops

        let totalKey = CropCache.Key(card: flat.key.card, row: flat.key.row, kind: "total")
        let contextKey = CropCache.Key(card: flat.key.card, row: flat.key.row, kind: "context")
        let marksKey = CropCache.Key(card: flat.key.card, row: flat.key.row, kind: "marks")

        // The three pictures of one cell have nothing to do with each other,
        // and awaiting them in a row cost the sum of three round trips to show
        // the first one.
        async let total = cache.image(totalKey)
        async let context = cache.image(contextKey, when: showWholeRow)
        async let tally = cache.image(marksKey, when: flat.cell.tallyOnly)
        _ = await (total, context, tally)

        // Somebody who taps faster than the engine answers has already moved
        // on. The crops are in the cache either way and the cell they belong
        // to has its own load running; this one just stops talking.
        guard model.current?.key == flat.key else { return }
        revision &+= 1

        // The cells they are about to reach, while they are still reading this
        // one. This is the part that makes "Next" instant: by the time the tap
        // lands the picture is already decoded, and the screen paints in the
        // frame the tap arrived in.
        cache.prefetch(cropsAhead())
    }

    /// Three cells ahead: enough to stay in front of somebody typing quickly,
    /// and short enough not to encode a whole event's crops for a list that is
    /// usually left half done.
    private func cropsAhead() -> [CropCache.Key] {
        var keys: [CropCache.Key] = []
        for offset in 1...3 {
            let at = model.index + offset
            guard model.cells.indices.contains(at) else { break }
            let flat = model.cells[at]
            keys.append(.init(card: flat.key.card, row: flat.key.row, kind: "total"))
            if showWholeRow {
                keys.append(.init(card: flat.key.card, row: flat.key.row, kind: "context"))
            }
            if flat.cell.tallyOnly {
                keys.append(.init(card: flat.key.card, row: flat.key.row, kind: "marks"))
            }
        }
        return keys
    }
}

/// 54pt, and the pressed state tints from the accent ramp rather than fading.
///
/// On glass the tint is the same idea at a strength a lens can carry, and the
/// lift under the finger is the system's own -- `interactive` glass answers a
/// press better than anything drawn by hand, and it is the same 54pt target.
private struct KeypadKeyStyle: ButtonStyle {
    /// `C` and backspace. They take a value away rather than add one, and a
    /// keypad worked for an hour is easier to hit blind when the two keys you
    /// reach for by mistake are not the same colour as the ten you want.
    var clearing = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(clearing ? Nocturne.accent300 : Nocturne.text)
            .controlSurface(
                RoundedRectangle(
                    cornerRadius: Nocturne.hasGlass ? Nocturne.Radius.glassKey : Nocturne.Radius.key,
                    style: .continuous
                ),
                tint: tint(pressed: configuration.isPressed),
                fill: configuration.isPressed ? Nocturne.accent.opacity(0.22) : Nocturne.surface,
                stroke: configuration.isPressed ? Nocturne.accent : Nocturne.divider
            )
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.6), value: configuration.isPressed)
    }

    /// A key at rest still needs a ground.
    ///
    /// Untinted glass over this screen's darkest band is very nearly the ground
    /// itself: the first pass had twelve digits floating on nothing, which is
    /// worse than the flat `surface` the design started from. So the digits
    /// carry a neutral lift -- not accent, which would make ten keys look like
    /// ten affirmative actions -- and only `C` and backspace are tinted.
    private func tint(pressed: Bool) -> Color? {
        if pressed { return Nocturne.accent.opacity(0.45) }
        return clearing ? Nocturne.accent.opacity(0.20) : Nocturne.text.opacity(0.10)
    }
}
