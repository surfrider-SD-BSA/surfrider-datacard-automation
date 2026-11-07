//
//  The camera, and what happens to each frame and photograph.
//
//  Frames are small and frequent: they say where the card is and whether it is
//  time to take the picture. The picture itself is a separate full-resolution
//  photograph, whose corners are found again, because the card or phone may
//  have shifted in between. Everything but publishing happens on `work`, one
//  thing at a time, which is also what keeps the pages in order.
//
//  THE SIMULATOR HAS NO CAMERA. Under `targetEnvironment(simulator)` a drawn
//  card takes its place, so the rest can be run. That says nothing about focus,
//  light, or how well a real card is found.
//

import AVFoundation
import CoreImage
import Combine
import UIKit

final class CardScanner: NSObject, ObservableObject {
    enum Access { case unknown, allowed, denied }

    @Published private(set) var access = Access.unknown
    @Published private(set) var status = AutoCapture.Status.lookingForCard
    @Published private(set) var quad: ScanQuad?
    @Published private(set) var pages: Int
    @Published private(set) var thumbnail: UIImage?
    /// The latest thing worth telling the volunteer about the last page.
    @Published private(set) var warning: String?
    /// Off leaves only the shutter.
    @Published var handsFree = true

    #if targetEnvironment(simulator)
    @Published private(set) var drawnFrame: UIImage?
    private var drawnFeed: DispatchSourceTimer?
    private var lastDrawn: CIImage?
    #endif

    static var available: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
        #endif
    }

    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let sessionQueue = DispatchQueue(label: "cards.scanner.session")
    private let work = DispatchQueue(label: "cards.scanner.work")
    private let flattener = PageFlattener()
    private let store: ScanPageStore

    // Touched on `work` only.
    private var auto = AutoCapture()
    private var lastAnalysis: TimeInterval = 0
    private var lastQuad: ScanQuad?
    private var lastSide: PageMeasures.Side?
    private var inFlight = false
    private var autoEnabled = true
    private var paused = false
    private var configured = false

    /// About eight looks a second. More than that only warms the phone.
    private static let analysisInterval: TimeInterval = 0.12

    init(store: ScanPageStore = .shared) {
        self.store = store
        self.pages = store.count
        super.init()
    }

    // MARK: Starting and stopping

    func start() {
        work.async { self.pickUpWhereLeftOff() }
        #if targetEnvironment(simulator)
        DispatchQueue.main.async { self.access = .allowed }
        startDrawnFeed()
        #else
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            run()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted { self.run() } else { DispatchQueue.main.async { self.access = .denied } }
            }
        default:
            DispatchQueue.main.async { self.access = .denied }
        }
        #endif
    }

    func stop() {
        #if targetEnvironment(simulator)
        drawnFeed?.cancel()
        drawnFeed = nil
        #else
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
        #endif
    }

    /// A scan carried on later must not retake the page still lying there.
    private func pickUpWhereLeftOff() {
        let count = store.count
        guard count > 0, let last = store.image(at: count - 1), let page = CIImage(image: last) else { return }
        auto.didKeep(flattener.measure(page).fingerprint)
        lastSide = flattener.side(of: page)
        let picture = flattener.thumbnail(page, width: 120)
        DispatchQueue.main.async {
            self.thumbnail = picture
            self.status = .waitingForNextPage
        }
    }

    private func run() {
        sessionQueue.async {
            if !self.configured {
                guard self.configure() else {
                    DispatchQueue.main.async { self.access = .denied }
                    return
                }
                self.configured = true
            }
            if !self.session.isRunning { self.session.startRunning() }
            DispatchQueue.main.async { self.access = .allowed }
        }
    }

    private func configure() -> Bool {
        guard
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device)
        else { return false }

        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        guard session.canAddInput(input), session.canAddOutput(photoOutput), session.canAddOutput(videoOutput)
        else { return false }
        session.addInput(input)
        session.addOutput(photoOutput)
        session.addOutput(videoOutput)

        photoOutput.maxPhotoQualityPrioritization = .balanced
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: work)

        // A photo's upright comes from this; frames are turned in `captureOutput`.
        if let connection = photoOutput.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
        }

        if (try? device.lockForConfiguration()) != nil {
            // A card is held close, so don't let focus hunt out to the distance.
            if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
            device.unlockForConfiguration()
        }
        return true
    }

    // MARK: Taking pictures

    /// The shutter. Takes the picture whatever the page-change check thinks;
    /// only a page with no corners found is turned away, in `keep`.
    func shutter() {
        work.async { self.take(manual: true) }
    }

    func setHandsFree(_ on: Bool) {
        handsFree = on
        work.async { self.autoEnabled = on }
    }

    /// No pictures by itself while a question is on screen, so the count the
    /// question asks about stays true.
    func setPaused(_ on: Bool) {
        work.async { self.paused = on }
    }

    private func take(manual: Bool) {
        guard !inFlight else { return }
        inFlight = true
        auto.willTake()
        publish(status: .taking)

        #if targetEnvironment(simulator)
        if let frame = lastDrawn { keep(photo: frame, manual: manual) } else { failed("No picture") }
        #else
        let settings = AVCapturePhotoSettings()
        settings.flashMode = .off
        settings.photoQualityPrioritization = .balanced
        let wrapper = PhotoDelegate { [weak self] data in
            self?.work.async {
                guard let self else { return }
                self.photoDelegate = nil
                guard let data, let photo = CIImage(data: data, options: [.applyOrientationProperty: true]) else {
                    self.failed("That picture didn't work. Try again")
                    return
                }
                self.keep(photo: photo, manual: manual)
            }
        }
        photoDelegate = wrapper
        photoOutput.capturePhoto(with: settings, delegate: wrapper)
        #endif
    }

    private var photoDelegate: PhotoDelegate?

    private func failed(_ message: String) {
        inFlight = false
        auto.didFail()
        publish(warning: message)
    }

    /// Runs on `work`, like everything else that touches pages.
    private func keep(photo: CIImage, manual: Bool) {
        let upright = photo.transformed(by: CGAffineTransform(
            translationX: -photo.extent.minX, y: -photo.extent.minY
        ))
        // The frames' corners are only a fallback: the photograph has more to go on.
        guard let quad = flattener.findCard(in: upright) ?? lastQuad,
              let flat = flattener.flatten(upright, quad: quad)
        else {
            failed("Couldn't find the card's corners, so that wasn't kept. Try a darker surface")
            return
        }

        let measured = flattener.measure(flat)
        let sharp = measured.sharpness >= PageMeasures.minimumSharpness
        if !sharp, !manual {
            failed("That one was blurry, so it wasn't kept. Hold still")
            return
        }

        let page = flattener.enhanced(flat)
        guard let jpeg = flattener.jpeg(page) else {
            failed("That picture couldn't be saved. Try again")
            return
        }
        let count: Int
        do {
            count = try store.append(jpeg)
        } catch {
            failed("That picture couldn't be saved: the phone may be full")
            return
        }

        inFlight = false
        auto.didKeep(measured.fingerprint)

        var note: String?
        let side = flattener.side(of: page)
        if !sharp {
            note = "Page \(count) looks blurry. Tap Retake to take it again"
        } else if flat.extent.width > flat.extent.height {
            note = "Page \(count) is sideways. It may need a retake"
        } else if let side, side == lastSide {
            note = ScanPageCount.repeatedSide(side)
        }
        lastSide = side

        let picture = flattener.thumbnail(page, width: 120)
        DispatchQueue.main.async {
            self.pages = count
            self.thumbnail = picture
            self.warning = note
            self.status = .waitingForNextPage
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
    }

    /// Throws the last page away, to take it again.
    func retakeLast() {
        work.async {
            let left = self.store.removeLast()
            self.auto.didUndo()
            // The one before is no longer known here, so no "same side" warning
            // can be built on it.
            self.lastSide = nil
            DispatchQueue.main.async {
                self.pages = left
                self.thumbnail = nil
                self.warning = nil
            }
        }
    }

    /// Throws away all of it.
    func discard() {
        work.async {
            self.store.clear()
            self.auto = AutoCapture()
            self.lastSide = nil
            DispatchQueue.main.async {
                self.pages = 0
                self.thumbnail = nil
                self.warning = nil
            }
        }
    }

    // MARK: Each frame

    private func analyse(_ image: CIImage, time: TimeInterval) {
        guard !paused, time - lastAnalysis >= Self.analysisInterval else { return }
        lastAnalysis = time

        let frameSize = image.extent.size
        let upright = image.transformed(by: CGAffineTransform(
            translationX: -image.extent.minX, y: -image.extent.minY
        ))
        let found = flattener.findCard(in: upright)
        lastQuad = found

        var frame = AutoCapture.Frame(time: time, quad: found, problem: nil, isSharp: false, fingerprint: nil)
        if let found {
            frame.problem = ScanPosition.judge(found, frame: frameSize)
            if let flat = flattener.flatten(upright, quad: found) {
                let measured = flattener.measure(flat)
                frame.isSharp = measured.sharpness >= PageMeasures.minimumSharpness
                frame.fingerprint = measured.fingerprint
            }
        }

        let status = auto.observe(frame)
        DispatchQueue.main.async {
            self.quad = found
            // The picture's own outcome decides what is said once it is taken.
            self.status = status == .shoot ? .taking : status
        }
        guard status == .shoot else { return }
        if autoEnabled, !paused {
            take(manual: false)
        } else {
            // Told to wait for the shutter: keep looking, without shooting.
            auto.didFail()
        }
    }

    private func publish(status: AutoCapture.Status) {
        DispatchQueue.main.async { self.status = status }
    }

    private func publish(warning: String) {
        DispatchQueue.main.async { self.warning = warning }
    }
}

extension CardScanner: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection
    ) {
        guard !inFlight, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        // The sensor's frames lie on their side; the phone is held upright.
        analyse(CIImage(cvPixelBuffer: buffer).oriented(.right), time: time)
    }
}

/// `AVCapturePhotoOutput` wants an object per picture. Answers exactly once, so
/// a picture that never arrives cannot leave the scanner waiting for it forever.
private final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private var finished: ((Data?) -> Void)?
    init(finished: @escaping (Data?) -> Void) { self.finished = finished }

    private func answer(_ data: Data?) {
        finished?(data)
        finished = nil
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        answer(error == nil ? photo.fileDataRepresentation() : nil)
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
        error: Error?
    ) {
        answer(nil)
    }
}

// MARK: - A drawn card, for the simulator

#if targetEnvironment(simulator)
extension CardScanner {
    private func startDrawnFeed() {
        let started = Date()
        let timer = DispatchSource.makeTimerSource(queue: work)
        timer.schedule(deadline: .now(), repeating: Self.analysisInterval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let elapsed = Date().timeIntervalSince(started)
            // A side for four seconds, then a second of empty table while the
            // card is turned over.
            let cycle = Int(elapsed / 5)
            let onTable = elapsed.truncatingRemainder(dividingBy: 5) < 4
            let image = Self.drawnFrame(side: cycle % 2, onTable: onTable)
            self.lastDrawn = image
            let picture = self.flattener.thumbnail(image, width: 540)
            DispatchQueue.main.async { self.drawnFrame = picture }
            if !self.inFlight { self.analyse(image, time: elapsed) }
        }
        drawnFeed = timer
        timer.resume()
    }

    /// A dark table and a slightly keystoned card with its print on it.
    private static func drawnFrame(side: Int, onTable: Bool) -> CIImage {
        let frame = CGRect(x: 0, y: 0, width: 1080, height: 1440)
        let table = CIImage(color: CIColor(red: 0.12, green: 0.13, blue: 0.16)).cropped(to: frame)
        guard onTable else { return table }

        let size = CGSize(width: 850, height: 1100)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let card = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.black.setFill()
            if side == 1 { context.fill(CGRect(x: 40, y: 30, width: 770, height: 50)) }
            for row in stride(from: 90, to: 1040, by: 24) {
                context.fill(CGRect(x: 40, y: row + side * 8, width: 770, height: 2))
            }
            for column in stride(from: 40, to: 820, by: 96 + side * 40) {
                context.fill(CGRect(x: column, y: 90, width: 2, height: 950))
            }
        }
        guard let flat = CIImage(image: card) else { return table }
        let warped = flat.applyingFilter("CIPerspectiveTransform", parameters: [
            "inputTopLeft": CIVector(x: 130, y: 1330),
            "inputTopRight": CIVector(x: 950, y: 1320),
            "inputBottomRight": CIVector(x: 990, y: 110),
            "inputBottomLeft": CIVector(x: 90, y: 120),
        ])
        return warped.composited(over: table).cropped(to: frame)
    }
}
#endif
