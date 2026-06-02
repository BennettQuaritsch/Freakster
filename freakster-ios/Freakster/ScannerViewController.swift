//
//  ScannerViewController.swift
//  Freakster
//

import AVFoundation
import UIKit

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCodeScanned: ((String) -> Void)?
    var onScanFeedback: (() -> Void)?
    var cornerRadius: CGFloat = 24

    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var metadataOutput: AVCaptureMetadataOutput?
    private var lastScannedCode: String?
    private var lastScanTime: Date?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.clipsToBounds = true
        view.layer.masksToBounds = true
        setupCamera()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        view.layer.cornerRadius = cornerRadius
        updateRectOfInterest()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startRunning()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopRunning()
    }

    private func setupCamera() {
        guard let device = AVCaptureDevice.default(for: .video) else { return }

        do {
            let input = try AVCaptureDeviceInput(device: device)

            guard captureSession.canAddInput(input) else { return }
            captureSession.addInput(input)

            let metadataOutput = AVCaptureMetadataOutput()
            guard captureSession.canAddOutput(metadataOutput) else { return }
            captureSession.addOutput(metadataOutput)

            metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
            metadataOutput.metadataObjectTypes = [.qr]
            self.metadataOutput = metadataOutput

            let preview = AVCaptureVideoPreviewLayer(session: captureSession)
            preview.videoGravity = .resizeAspectFill
            preview.frame = view.bounds
            view.layer.addSublayer(preview)
            previewLayer = preview
        } catch {
            print("Camera setup error: \(error.localizedDescription)")
        }
    }

    private func updateRectOfInterest() {
        guard let previewLayer, let metadataOutput,
              captureSession.isRunning,
              view.bounds.width > 0, view.bounds.height > 0 else { return }
        // `metadataOutputRectConverted` returns CGRectZero until the session is running,
        // so we only call it once `captureSession.isRunning == true`.
        let rect = previewLayer.metadataOutputRectConverted(fromLayerRect: view.bounds)
        guard rect.width > 0, rect.height > 0 else { return }
        metadataOutput.rectOfInterest = rect
    }

    private func startRunning() {
        guard !captureSession.isRunning else { return }
        Task.detached(priority: .userInitiated) { [captureSession, weak self] in
            captureSession.startRunning()
            await MainActor.run {
                self?.updateRectOfInterest()
            }
        }
    }

    private func stopRunning() {
        guard captureSession.isRunning else { return }
        Task.detached(priority: .userInitiated) { [captureSession] in
            captureSession.stopRunning()
        }
    }

    // MARK: - AVCaptureMetadataOutputObjectsDelegate

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              metadataObject.type == .qr,
              let value = metadataObject.stringValue else {
            return
        }

        // Debounce: same code within 3 seconds
        if let lastCode = lastScannedCode,
           let lastTime = lastScanTime,
           lastCode == value,
           Date.now.timeIntervalSince(lastTime) < 3.0 {
            return
        }

        lastScannedCode = value
        lastScanTime = .now

        onScanFeedback?()
        onCodeScanned?(value)
    }
}
