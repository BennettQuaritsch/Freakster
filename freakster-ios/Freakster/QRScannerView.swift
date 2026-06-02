//
//  QRScannerView.swift
//  Freakster
//

import SwiftUI

struct QRScannerView: UIViewControllerRepresentable {
    var cornerRadius: CGFloat = 24
    var onCodeScanned: (String) -> Void
    var onScanFeedback: (() -> Void)? = nil

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.cornerRadius = cornerRadius
        controller.onCodeScanned = onCodeScanned
        controller.onScanFeedback = onScanFeedback
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {
        uiViewController.cornerRadius = cornerRadius
        uiViewController.onCodeScanned = onCodeScanned
        uiViewController.onScanFeedback = onScanFeedback
    }
}
