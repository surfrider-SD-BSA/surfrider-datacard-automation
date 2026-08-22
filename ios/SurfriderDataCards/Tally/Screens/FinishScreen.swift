//
//  8 — Finish and send
//
//  The export gate: warnings, not walls. You can send it anyway -- you are the
//  one who saw the paper. A warning somebody can override beats a gate they
//  route around, which is the argument in `checkExportGate` in
//  src/lib/schema.ts and the reason nothing here refuses.
//

import SwiftUI

struct FinishScreen: View {
    @ObservedObject var model: TallyModel
    @Environment(\.dismiss) private var dismiss

    @State private var working = false
    @State private var sharing = false

    var body: some View {
        ScreenBody {
            NavBar(back: "Cards") { dismiss() }

            if model.exportedFile != nil {
                success
            } else {
                gate
            }
        }
        .navigationBarBackButtonHidden()
        .sheet(isPresented: $sharing) {
            if let file = model.exportedFile { ShareSheet(items: [file]) }
        }
    }

    // MARK: -

    private var gate: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Before it goes")
                    .font(Nocturne.Face.title(28))
                    .tracking(-0.28)
                    .foregroundStyle(Nocturne.text)
                Text("Warnings, not walls. You can send it anyway — you are the one who saw the paper.")
                    .font(Nocturne.Face.body(13))
                    .lineSpacing(3)
                    .foregroundStyle(Nocturne.text(60))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .pageMargin()
            .padding(.top, 6)
            .padding(.bottom, 18)

            ScrollView {
                VStack(spacing: 10) {
                    ForEach(model.gateItems) { item in
                        HStack(alignment: .top, spacing: 11) {
                            Image(systemName: item.icon)
                                .font(.system(size: 15))
                                .foregroundStyle(item.color)
                                .padding(.top, 1)
                            Text(item.text)
                                .font(Nocturne.Face.body(13))
                                .lineSpacing(3)
                                .foregroundStyle(Nocturne.text(78))
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 12)
                        .padding(.horizontal, 13)
                        .overlay(
                            RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                                .stroke(Nocturne.divider, lineWidth: 1)
                        )
                    }

                    if let error = model.exportError {
                        Text(error)
                            .font(Nocturne.Face.body(13))
                            .foregroundStyle(Nocturne.accent400)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .pageMargin()
            }

            Spacer(minLength: 0)

            Button {
                working = true
                Task {
                    await model.makeSpreadsheet()
                    working = false
                }
            } label: {
                HStack(spacing: 9) {
                    if working {
                        ProgressView().tint(Nocturne.accent)
                    } else {
                        Image(systemName: Nocturne.Icon.spreadsheet)
                    }
                    Text("Make the spreadsheet")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(working || model.values.isEmpty || !model.event.isComplete)
            .pageMargin()
            .padding(.top, 16)
            .padding(.bottom, Nocturne.safeBottom)
        }
    }

    private var success: some View {
        VStack(spacing: 0) {
            Spacer()

            ZStack {
                Circle()
                    .stroke(Nocturne.accent, lineWidth: 1)
                    .background(Circle().fill(Nocturne.accent.opacity(0.09)).scaleEffect(1.31))
                Image(systemName: Nocturne.Icon.check)
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(Nocturne.accent)
            }
            .frame(width: 64, height: 64)

            Text("Ready to send")
                .font(Nocturne.Face.title(26))
                .tracking(-0.26)
                .foregroundStyle(Nocturne.text)
                .padding(.top, 22)
                .padding(.bottom, 8)

            Text(model.exportedFile?.lastPathComponent ?? model.exportName)
                .font(Nocturne.Face.label(14))
                .foregroundStyle(Nocturne.text(65))
                .multilineTextAlignment(.center)
                .padding(.bottom, 4)

            Text("\(model.checkedCount) value\(model.checkedCount == 1 ? "" : "s"), \(model.scan?.cards.count ?? 0) card\((model.scan?.cards.count ?? 0) == 1 ? "" : "s"), in the chapter's template")
                .font(Nocturne.Face.label(12))
                .foregroundStyle(Nocturne.text(42))
                .multilineTextAlignment(.center)

            VStack(spacing: 10) {
                Button {
                    sharing = true
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: Nocturne.Icon.share)
                        Text("Send it on")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())

                Button("Back to cleanups") { model.backToCleanups() }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(.top, 30)

            // The last thing said before the file leaves, because it is the
            // one promise the whole tool is built on.
            Text("The scan stays on this phone. Only the spreadsheet leaves.")
                .font(Nocturne.Face.label(12))
                .foregroundStyle(Nocturne.text(42))
                .multilineTextAlignment(.center)
                .padding(.top, 18)

            Spacer()
        }
        .padding(.horizontal, 26)
        .padding(.bottom, 60)
    }
}
