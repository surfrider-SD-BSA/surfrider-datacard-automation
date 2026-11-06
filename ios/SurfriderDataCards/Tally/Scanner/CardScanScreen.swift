//
//  The card scanner's screen.
//
//  No page limit, takes the picture by itself when a card is still and sharp,
//  and says what is wrong while it can still be fixed.
//

import AVFoundation
import SwiftUI

struct CardScanScreen: View {
    /// There are pages in the store and the volunteer is done taking them.
    let onDone: () -> Void
    /// Closed; any pages stay in the store for next time, unless thrown away.
    let onClose: () -> Void

    @StateObject private var scanner = CardScanner()
    @State private var confirmingOdd = false
    @State private var confirmingClose = false

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ZStack {
                preview
                    .aspectRatio(3.0 / 4.0, contentMode: .fit)
                    .overlay { outline }
                    .clipShape(RoundedRectangle(cornerRadius: Nocturne.Radius.viewfinder))
                VStack(spacing: 8) {
                    if let warning = scanner.warning { pill(warning, alert: true) }
                    Spacer()
                    pill(statusText, alert: statusIsProblem)
                }
                .padding(12)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            controls
        }
        .background(Color.black.ignoresSafeArea())
        // The app's purple is unreadable on the dialogs' gray.
        .tint(Nocturne.text)
        .onAppear {
            // Hands-free means nobody is touching the screen to keep it awake.
            UIApplication.shared.isIdleTimerDisabled = true
            scanner.start()
        }
        .onChange(of: confirmingOdd || confirmingClose) { asking in scanner.setPaused(asking) }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            scanner.stop()
        }
        .confirmationDialog(
            ScanPageCount.oddWarning, isPresented: $confirmingOdd, titleVisibility: .visible
        ) {
            Button("Use these \(scanner.pages) pages anyway", action: onDone)
            // Not `role: .cancel`, which this kind of dialog can leave unshown.
            Button("Keep scanning") {}
        }
        .confirmationDialog(
            "You have \(scanner.pages) \(scanner.pages == 1 ? "page" : "pages") so far",
            isPresented: $confirmingClose, titleVisibility: .visible
        ) {
            Button("Keep them for later", action: onClose)
            Button("Throw them away", role: .destructive) {
                scanner.discard()
                onClose()
            }
            Button("Keep scanning") {}
        }
    }

    private var topBar: some View {
        HStack {
            Button("Close") {
                if scanner.pages > 0 { confirmingClose = true } else { onClose() }
            }
            .buttonStyle(ChromeButtonStyle())
            Spacer()
            VStack(spacing: 2) {
                Text(ScanPageCount.summary(scanner.pages))
                    .font(Nocturne.Face.label(15, weight: .medium))
                    .foregroundStyle(Nocturne.text)
                    .accessibilityIdentifier("scan-page-count")
                Text(ScanPageCount.nextStep(scanner.pages))
                    .font(Nocturne.Face.label(12))
                    .foregroundStyle(ScanPageCount.isOdd(scanner.pages) ? Nocturne.accent400 : Nocturne.text(60))
            }
            Spacer()
            Button("Done") {
                if ScanPageCount.isOdd(scanner.pages) { confirmingOdd = true } else { onDone() }
            }
            .buttonStyle(ChromeButtonStyle())
            .disabled(scanner.pages == 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private var controls: some View {
        HStack {
            // The last page, and the way to take it again.
            Button(action: scanner.retakeLast) {
                VStack(spacing: 4) {
                    Group {
                        if let thumbnail = scanner.thumbnail {
                            Image(uiImage: thumbnail).resizable().scaledToFit()
                        } else {
                            Image(systemName: "arrow.uturn.backward")
                                .font(.system(size: 18))
                        }
                    }
                    .frame(width: 40, height: 52)
                    Text("Retake").font(Nocturne.Face.label(12))
                }
            }
            .foregroundStyle(Nocturne.text)
            .disabled(scanner.pages == 0)
            .opacity(scanner.pages == 0 ? 0.35 : 1)
            .frame(width: 88)

            Spacer()

            Button(action: scanner.shutter) {
                ZStack {
                    Circle().fill(Nocturne.text).frame(width: 60, height: 60)
                    Circle().stroke(Nocturne.text, lineWidth: 3).frame(width: 72, height: 72)
                }
            }
            .accessibilityLabel("Take the picture")
            .disabled(scanner.access != .allowed)

            Spacer()

            Toggle(isOn: Binding(get: { scanner.handsFree }, set: scanner.setHandsFree)) {
                Text(scanner.handsFree ? "Auto on" : "Auto off").font(Nocturne.Face.label(12)).foregroundStyle(Nocturne.text)
            }
            .toggleStyle(.button)
            .tint(Nocturne.accent)
            .frame(width: 88)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
    }

    @ViewBuilder
    private var preview: some View {
        switch scanner.access {
        case .denied:
            VStack(spacing: 12) {
                Text("The app isn't allowed to use the camera.")
                    .font(Nocturne.Face.body(14))
                    .foregroundStyle(Nocturne.text)
                    .multilineTextAlignment(.center)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .buttonStyle(TextButtonStyle(size: 14))
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Nocturne.captureGround)
        default:
            #if targetEnvironment(simulator)
            if let frame = scanner.drawnFrame {
                Image(uiImage: frame).resizable().scaledToFit()
            } else {
                Nocturne.captureGround
            }
            #else
            CameraPreview(session: scanner.session)
            #endif
        }
    }

    /// The card as it was last found.
    private var outline: some View {
        GeometryReader { geo in
            if let quad = scanner.quad {
                Path { path in
                    let points = quad.corners.map {
                        CGPoint(x: $0.x * geo.size.width, y: (1 - $0.y) * geo.size.height)
                    }
                    path.addLines(points)
                    path.closeSubpath()
                }
                .stroke(statusIsProblem ? Color.orange : Nocturne.accent, lineWidth: 3)
            }
        }
        .allowsHitTesting(false)
    }

    private var statusText: String {
        switch scanner.status {
        case .lookingForCard: return "Looking for a card"
        case .problem(let problem): return problem.message
        case .blurry: return "Blurry. Hold still, or find more light"
        case .holding, .shoot:
            return scanner.handsFree ? "Hold still" : "Ready. Tap the shutter"
        case .taking: return "Taking the picture"
        case .waitingForNextPage:
            return scanner.handsFree ? "Got it. Next page, or tap the shutter" : "Got it. Next page"
        }
    }

    private var statusIsProblem: Bool {
        switch scanner.status {
        case .problem, .blurry: return true
        default: return false
        }
    }

    private func pill(_ text: String, alert: Bool) -> some View {
        Text(text)
            .font(Nocturne.Face.label(13, weight: .medium))
            .multilineTextAlignment(.center)
            .foregroundStyle(alert ? Color.black : Nocturne.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                Capsule().fill(alert ? Color.orange : Color.black.opacity(0.6))
            )
    }
}

/// The camera's live picture, fitted whole so `outline` can be laid over it.
private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

        /// Upright, which only sticks once the session has its camera.
        override func layoutSubviews() {
            super.layoutSubviews()
            guard let connection = preview.connection else { return }
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
        }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.preview.session = session
        view.preview.videoGravity = .resizeAspect
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}
}
