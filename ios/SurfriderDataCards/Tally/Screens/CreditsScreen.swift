//
//  Credits — what the app is built on, and the licences that ask to be named.
//
//  Reached from the version line on the first screen. Every entry here is a
//  condition of a licence, so an entry comes out only when what it credits
//  does: the handwriting readers (Microsoft TrOCR, MIT), the rainfall numbers
//  two of them practised on (Rainfall Rescue, CC BY 4.0), and the runtime that
//  runs them (ONNX Runtime, MIT).
//

import SwiftUI

struct CreditsScreen: View {
    @Environment(\.dismiss) private var dismiss

    private struct Credit: Identifiable {
        let name: String
        let what: String
        let licence: String
        let link: String
        var id: String { name }
    }

    private let credits = [
        Credit(
            name: "TrOCR",
            what: "The handwriting readers start from Microsoft's TrOCR models (small, base and large, handwritten) and were then trained further on the chapter's own cards.",
            licence: "MIT License. Copyright (c) Microsoft Corporation.",
            link: "https://github.com/microsoft/unilm/tree/master/trocr"
        ),
        Credit(
            name: "Rainfall Rescue",
            what: "Two of the readers practised on handwritten rainfall numbers transcribed by the Rainfall Rescue volunteers (Hawkins et al.).",
            licence: "Creative Commons Attribution 4.0 (CC BY 4.0).",
            link: "https://zenodo.org/records/5770390"
        ),
        Credit(
            name: "ONNX Runtime",
            what: "Runs the readers on this phone.",
            licence: "MIT License. Copyright (c) Microsoft Corporation.",
            link: "https://github.com/microsoft/onnxruntime"
        ),
    ]

    var body: some View {
        ScreenBody {
            NavBar(back: "Cleanups") { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Credits")
                        .font(Nocturne.Face.title(30))
                        .tracking(-0.3)
                        .foregroundStyle(Nocturne.text)
                        .padding(.bottom, 8)
                    Text("Everything is read on this phone. These are the open models and data that make that possible.")
                        .font(Nocturne.Face.body(14))
                        .foregroundStyle(Nocturne.text(60))
                        .padding(.bottom, 18)

                    ForEach(credits) { credit in
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: credit.name)
                            Text(credit.what)
                                .font(Nocturne.Face.body(14))
                                .foregroundStyle(Nocturne.text)
                            Text(credit.licence)
                                .font(Nocturne.Face.body(13))
                                .foregroundStyle(Nocturne.text(60))
                            if let url = URL(string: credit.link) {
                                Link(credit.link, destination: url)
                                    .font(Nocturne.Face.body(13))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 22)
                    }

                    Text(Self.mit)
                        .font(Nocturne.Face.body(11))
                        .foregroundStyle(Nocturne.text(45))
                        .padding(.bottom, 40)
                }
                .pageMargin()
            }
        }
        .navigationBarBackButtonHidden()
    }

    /// The MIT licence asks for its notice to travel with the software.
    private static let mit = """
        MIT License

        Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

        The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        """
}
