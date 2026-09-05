//
//  1 — Cleanups (root)
//
//  Resume interrupted work, or start a new cleanup.
//

import SwiftUI

struct CleanupsScreen: View {
    @ObservedObject var model: TallyModel
    @ObservedObject var finished: FinishedStore

    var body: some View {
        ScreenBody(topPadding: 62) {
            VStack(alignment: .leading, spacing: 6) {
                Kicker(text: model.chapter)
                Text("Cleanups")
                    .font(Nocturne.Face.title(30))
                    .tracking(-0.3)
                    .foregroundStyle(Nocturne.text)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .pageMargin()
            .padding(.bottom, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let draft = model.offeredDraft {
                        draftCard(draft).pageMargin().padding(.top, 8)
                    }

                    if !finished.events.isEmpty {
                        SectionLabel(text: "Finished")
                            .pageMargin()
                            .padding(.top, 26)
                            .padding(.bottom, 8)

                        Panel {
                            VStack(spacing: 0) {
                                ForEach(finished.events) { event in
                                    eventRow(event)
                                }
                            }
                        }
                        .pageMargin()
                    }
                }
            }
            // The action floats over the list rather than sitting under it, so
            // a long list of finished cleanups scrolls past it instead of
            // stopping short. On iOS 26 the soft scroll edge is what separates
            // the two; below it, the ground fade in `pinnedActions` does.
            .softScrollEdges()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Button {
                    model.startNewCleanup()
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: Nocturne.Icon.add)
                        Text("Start a cleanup")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .pinnedActions()
            }
        }
    }

    // MARK: -

    /// A draft is offered with its age and its count, and the person chooses.
    /// Nothing is ever put back unasked -- see `resumeDraft`.
    private func draftCard(_ draft: Draft) -> some View {
        TintedPanel(radius: Nocturne.Radius.draftCard) {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(draftTitle(draft))
                        .font(Nocturne.Face.label(15, weight: .medium))
                        .foregroundStyle(Nocturne.text)
                    Spacer(minLength: 0)
                    Text("saved \(draft.age)")
                        .font(Nocturne.Face.label(11))
                        .foregroundStyle(Nocturne.accent300)
                }

                Text("\(draft.values.count) of \(draft.cellCount) cells checked. Your typing is on this phone — nothing has been put back until you say so.")
                    .font(Nocturne.Face.body(13))
                    .lineSpacing(3)
                    .foregroundStyle(Nocturne.text(68))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 9) {
                    Button("Pick up where I left off") { model.resumeDraft() }
                        .buttonStyle(PrimaryButtonStyle(minHeight: Nocturne.minTap, size: 14))
                    Button("Start fresh") { model.discardDraft() }
                        .buttonStyle(SecondaryButtonStyle(minHeight: Nocturne.minTap, size: 14))
                        .fixedSize(horizontal: true, vertical: false)
                }
                .padding(.top, 2)
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 15)
        }
    }

    private func draftTitle(_ draft: Draft) -> String {
        let beach = draft.event.shoreline.trimmingCharacters(in: .whitespaces)
        guard !beach.isEmpty else { return draft.fileName }
        guard let day = DateFormatter.iso.date(from: draft.event.date) else { return beach }
        return "\(beach), \(DateFormatter.short.string(from: day))"
    }

    private func eventRow(_ event: FinishedEvent) -> some View {
        RowButton {
            // Nothing to go back to: the values were not kept, only the record
            // that the work was done. Tapping is a no-op rather than a screen
            // that would have to invent what it shows.
        } content: {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.beach.isEmpty ? "Cleanup" : event.beach)
                        .font(Nocturne.Face.label(15, weight: .medium))
                        .foregroundStyle(Nocturne.text)
                    Text(event.meta)
                        .font(Nocturne.Face.label(12))
                        .foregroundStyle(Nocturne.text(52))
                }
                Spacer(minLength: 0)
                Image(systemName: Nocturne.Icon.forward)
                    .font(.system(size: 14))
                    .foregroundStyle(Nocturne.text(40))
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 15)
        }
    }
}
