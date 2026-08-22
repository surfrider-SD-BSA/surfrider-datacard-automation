//
//  2 — Event details
//
//  The header fields that appear only on the leader's card. Maps to
//  `eventMetadata` in src/lib/schema.ts and HEADER_ROWS in taxonomy.ts.
//
//  Duration defaults to two hours and the club to the chapter string. Both are
//  off-screen defaults rather than questions, because they are the same at
//  every cleanup this chapter runs.
//

import SwiftUI

struct EventScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScreenBody {
            NavBar(back: "Cleanups") { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("The event")
                            .font(Nocturne.Face.title(28))
                            .tracking(-0.28)
                            .foregroundStyle(Nocturne.text)
                        Text("Only the date and the beach are needed to finish. The rest is written on the leader's card and often on no other, so it is never held against you.")
                            .font(Nocturne.Face.body(13))
                            .lineSpacing(3)
                            .foregroundStyle(Nocturne.text(60))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.bottom, 0)

                    Field(label: "Date") {
                        DatePicker("", selection: dateBinding, displayedComponents: .date)
                            .labelsHidden()
                            .datePickerStyle(.compact)
                            .colorScheme(.dark)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Field(label: "Beach") {
                        TextField("Pacific Beach", text: $model.event.shoreline)
                            .textInputAutocapitalization(.words)
                    }

                    HStack(spacing: 12) {
                        Field(label: "Volunteers", optional: true) {
                            TextField("—", text: $model.event.volunteers).keyboardType(.numberPad)
                        }
                        Field(label: "Pounds", optional: true) {
                            TextField("—", text: $model.event.pounds).keyboardType(.decimalPad)
                        }
                    }

                    Field(label: "Your name", optional: true) {
                        TextField("Who is doing the entry", text: $model.event.dataEntryVolunteer)
                            .textInputAutocapitalization(.words)
                    }
                }
                .padding(.top, 6)
                .pageMargin()
            }
            .scrollDismissesKeyboard(.interactively)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                Button {
                    model.path.append(.capture)
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: Nocturne.Icon.capture)
                        Text("Scan the cards")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.event.isComplete)

                Text(model.event.isComplete ? "Everything needed is here." : "A date and a beach, and you can start.")
                    .font(Nocturne.Face.label(12))
                    .foregroundStyle(Nocturne.text(45))
            }
            .pageMargin()
            .padding(.top, 16)
            .padding(.bottom, Nocturne.safeBottom)
        }
        .navigationBarBackButtonHidden()
    }

    /// The form holds strings, because that is what the exporter takes and what
    /// the draft stores. The picker wants a Date, so it gets one here and
    /// nowhere else.
    private var dateBinding: Binding<Date> {
        Binding(
            get: { DateFormatter.iso.date(from: model.event.date) ?? Date() },
            set: { model.event.date = DateFormatter.iso.string(from: $0) }
        )
    }
}
