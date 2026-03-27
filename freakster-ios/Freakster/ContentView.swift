//
//  ContentView.swift
//  Freakster
//

import SwiftUI

struct ContentView: View {
    var spotifyManager: SpotifyManager
    @State private var showError = false
    @State private var errorDismissalTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            // Full-screen camera viewfinder
            QRScannerView { scannedCode in
                handleScannedCode(scannedCode)
            }
            .ignoresSafeArea()

            // Status indicator overlay
            VStack {
                HStack {
                    Spacer()
                    StatusDotView(
                        connectionStatus: spotifyManager.connectionStatus,
                        onTap: {
                            if spotifyManager.connectionStatus == .disconnected {
                                spotifyManager.connect()
                            }
                        }
                    )
                    .padding(24)
                }
                Spacer()
            }
        }
        .onChange(of: spotifyManager.lastError) { _, newError in
            if newError != nil {
                showError = true
                // Auto-dismiss after 4 seconds
                errorDismissalTask?.cancel()
                errorDismissalTask = Task {
                    try? await Task.sleep(for: .seconds(4))
                    showError = false
                }
            }
        }
        .onDisappear {
            errorDismissalTask?.cancel()
            errorDismissalTask = nil
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { showError = false }
        } message: {
            Text(spotifyManager.lastError ?? "Unknown error")
        }
    }

    private func handleScannedCode(_ code: String) {
        guard spotifyManager.connectionStatus == .connected,
              let uri = SpotifyURLParser.spotifyURI(from: code) else {
            return
        }
        spotifyManager.play(spotifyURI: uri)
    }
}
