//
//  ContentView.swift
//  Freakster
//

import SwiftUI
import UIKit

struct ContentView: View {
    var spotifyManager: SpotifyManager
    @State private var showError = false
    @State private var errorDismissalTask: Task<Void, Never>?
    @State private var glowAmount: CGFloat = 0
    @State private var glowTask: Task<Void, Never>?

    private let viewfinderCornerRadius: CGFloat = 24

    var body: some View {
        ZStack {
            Color.bg.ignoresSafeArea()

            ZStack() {
                VStack {
                    header
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                    
                    Spacer()
                }

                VStack(spacing: 32) {
                    Spacer(minLength: 0)

                    StatusDotView(
                        connectionStatus: spotifyManager.connectionStatus,
                        style: .inline,
                        onTap: {
                            if spotifyManager.connectionStatus == .disconnected {
                                spotifyManager.connect()
                            }
                        }
                    )

                    viewfinder
                        .frame(maxWidth: 320)
                        .aspectRatio(1, contentMode: .fit)
                        .padding(.horizontal, 32)

                    Spacer(minLength: 0)
                }
            }
        }
        .onChange(of: spotifyManager.lastError) { _, newError in
            if newError != nil {
                showError = true
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
            glowTask?.cancel()
            glowTask = nil
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { showError = false }
        } message: {
            Text(spotifyManager.lastError ?? "Unknown error")
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image("sound-icon")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 40, height: 40)
                .foregroundStyle(Color.brandPrimary)
            VStack(alignment: .leading, spacing: 4) {
                Text("freakster")
                    .font(.title.weight(.bold))
                    .tracking(-0.5)
                    .foregroundStyle(Color.textPrimary)
                Text("vol. \(appVersion)")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(2)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.textSecondary)
            }
            Spacer(minLength: 0)
        }
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1"
    }

    private var viewfinder: some View {
        QRScannerView(
            cornerRadius: viewfinderCornerRadius,
            onCodeScanned: handleScannedCode,
            onScanFeedback: triggerGlow
        )
        .clipShape(RoundedRectangle(cornerRadius: viewfinderCornerRadius, style: .continuous))
        .shadow(color: Color.brandPrimary.opacity(0.45 + 0.3 * glowAmount), radius: 24 + 10 * glowAmount)
        .shadow(color: Color.brandPrimary.opacity(0.95 * glowAmount), radius: 48 * glowAmount)
    }

    private func handleScannedCode(_ code: String) {
        guard spotifyManager.connectionStatus == .connected,
              let uri = SpotifyURLParser.spotifyURI(from: code) else {
            return
        }
        spotifyManager.play(spotifyURI: uri)
    }

    private func triggerGlow() {
        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        glowTask?.cancel()
        glowTask = Task { @MainActor in
            withAnimation(.easeOut(duration: 0.12)) { glowAmount = 1.0 }
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.55)) { glowAmount = 0.0 }
        }
    }
}

#Preview {
    ContentView(spotifyManager: SpotifyManager())
}
