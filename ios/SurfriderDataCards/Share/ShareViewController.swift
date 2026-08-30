//
//  What the share sheet shows when Data Cards is the destination.
//
//  This is why the app is in the row of icons at all. The document type in the
//  app's Info.plist already put "Copy to Data Cards" in the list below that
//  row, but only for apps that hand over a real file and only where the list is
//  scrolled far enough to find it. An extension is the supported way to be
//  where a person looks.
//
//  IT DOES NOT READ THE SCAN. An extension gets a fraction of the app's memory
//  and is killed without ceremony when it exceeds it; the pipeline in
//  Engine.swift is a WKWebView holding the reference card, the cell maps and
//  the digit model, and it has no business running here. All this does is copy
//  one PDF into the shared drawer and say so. The reading happens in the app,
//  on screen 3, exactly as it does for a file chosen from Files.
//
//  IT TRIES TO OPEN THE APP AND DOES NOT DEPEND ON IT. `NSExtensionContext.open`
//  is documented for Today extensions, and from a share extension it may simply
//  report failure -- the responder-chain trick that gets around that is the
//  kind of thing that passes review until it does not. So the button is an
//  attempt, and the sentence above it is true either way: the scan is waiting
//  in the app whether or not the tap gets there in one step.
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers

@objc(ShareViewController)
final class ShareViewController: UIViewController {

    private let state = ShareState()

    override func viewDidLoad() {
        super.viewDidLoad()

        // The sheet is the extension's whole window; the app's ground colour
        // under it stops the corners showing white on the way in.
        view.backgroundColor = UIColor(Nocturne.ground)

        let sheet = UIHostingController(
            rootView: ShareConfirmation(
                state: state,
                onOpen: { [weak self] in self?.openTheApp() },
                onDone: { [weak self] in self?.finish() }
            )
        )
        addChild(sheet)
        sheet.view.frame = view.bounds
        sheet.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sheet.view.backgroundColor = .clear
        view.addSubview(sheet.view)
        sheet.didMove(toParent: self)

        Task { await accept() }
    }

    // MARK: - Taking the file

    /// Find the one PDF among the attachments and copy it into the drawer.
    ///
    /// `loadFileRepresentation` hands back a URL that is valid only until the
    /// callback returns, which is the whole reason `SharedInbox.deposit` copies
    /// rather than moves.
    private func accept() async {
        guard let attachment = pdfProvider() else {
            state.failed(SharedInbox.Failure.notAPDF)
            return
        }

        // Read off the provider here, on the way in. `lowercased`, because a
        // scanner app that suggests "Scan.PDF" would otherwise be filed as
        // "Scan.PDF.pdf" -- and that name is what the capture screen puts on
        // the button.
        let suggested = attachment.provider.suggestedName.map {
            $0.lowercased().hasSuffix(".pdf") ? $0 : $0 + ".pdf"
        }

        do {
            let filed = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                attachment.provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, error in
                    if let error { continuation.resume(throwing: error); return }
                    guard let url else {
                        continuation.resume(throwing: SharedInbox.Failure.notAPDF); return
                    }
                    // Inside the callback, before the URL goes away.
                    do {
                        continuation.resume(returning: try SharedInbox.deposit(url, named: suggested ?? url.lastPathComponent))
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
            SharedInbox.sweep()
            state.waiting(named: SharedInbox.originalName(of: filed))
        } catch {
            state.failed(error)
        }
    }

    private func pdfProvider() -> Attachment? {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                    return Attachment(provider: provider)
                }
            }
        }
        return nil
    }

    /// `NSItemProvider` is documented as safe to use from any thread, and this
    /// one is only ever handed to `loadFileRepresentation`. It is not marked
    /// `Sendable`, though, and the continuation below is a `@Sendable` closure,
    /// so the compiler has no way to know that. Carried across in a box that
    /// says so once, rather than by turning the check off for the file.
    private struct Attachment: @unchecked Sendable {
        let provider: NSItemProvider
    }

    // MARK: - Leaving

    /// Ask the system to bring the app forward. See the note at the top: this
    /// is allowed to fail, and failing costs one tap rather than the scan.
    private func openTheApp() {
        guard let url = URL(string: "datacards://inbox") else { finish(); return }
        extensionContext?.open(url) { [weak self] _ in
            Task { @MainActor in self?.finish() }
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}

// MARK: -

@MainActor
final class ShareState: ObservableObject {

    enum Stage {
        case working
        case waiting(name: String)
        case failed(message: String)
    }

    @Published private(set) var stage: Stage = .working

    func waiting(named name: String) { stage = .waiting(name: name) }

    func failed(_ error: Error) {
        let described = (error as? LocalizedError)?.errorDescription
        stage = .failed(message: described ?? "That file could not be handed to Data Cards.")
    }
}

// MARK: -

/// Small, quiet, and over in one tap. The extension is a doorway, not a screen.
private struct ShareConfirmation: View {

    @ObservedObject var state: ShareState
    let onOpen: () -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            VStack(spacing: 14) {
                icon
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(Nocturne.accent)

                Text(title)
                    .font(Nocturne.Face.title(20))
                    .tracking(-0.2)
                    .foregroundStyle(Nocturne.text)
                    .multilineTextAlignment(.center)

                Text(detail)
                    .font(Nocturne.Face.body(13))
                    .lineSpacing(2)
                    .foregroundStyle(Nocturne.text(60))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 26)

            Spacer(minLength: 0)

            VStack(spacing: 10) {
                if case .waiting = state.stage {
                    Button("Open Data Cards", action: onOpen)
                        .buttonStyle(SharePrimaryButton())
                }
                Button(dismissLabel, action: onDone)
                    .font(Nocturne.Face.label(15))
                    .foregroundStyle(Nocturne.text(60))
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Nocturne.ground)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var icon: some View {
        switch state.stage {
        case .working: ProgressView().tint(Nocturne.accent)
        case .waiting: Image(systemName: Nocturne.Icon.pass)
        case .failed: Image(systemName: Nocturne.Icon.warning)
        }
    }

    private var title: String {
        switch state.stage {
        case .working: return "Sending the scan"
        case .waiting: return "Waiting in Data Cards"
        case .failed: return "Not sent"
        }
    }

    private var detail: String {
        switch state.stage {
        case .working:
            return "Copying the PDF across."
        case .waiting(let name):
            // The event's date and beach come first, which is why this says
            // offered rather than read -- the app does not start reading a scan
            // the moment it lands. TallyModel.pendingPDF has the argument.
            return "\(name) is on the capture screen, ready to read. Nothing has left the phone."
        case .failed(let message):
            return message
        }
    }

    private var dismissLabel: String {
        if case .waiting = state.stage { return "Not now" }
        return "Close"
    }
}

/// The app's primary button, transcribed rather than shared: Components.swift
/// is built around TallyModel, and an extension gets a fraction of the app's
/// memory. Outlined accent on the ground, at 52 points -- PrimaryButtonStyle,
/// kept in step by hand because there are two of them and only one is here.
private struct SharePrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Nocturne.Face.label(16, weight: .medium))
            .foregroundStyle(Nocturne.accent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .fill(Nocturne.accent.opacity(configuration.isPressed ? 0.22 : 0))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Nocturne.Radius.base)
                    .stroke(Nocturne.accent, lineWidth: 1)
            )
    }
}
