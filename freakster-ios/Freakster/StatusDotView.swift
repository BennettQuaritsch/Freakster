//
//  StatusDotView.swift
//  Freakster
//

import SwiftUI

struct StatusDotView: View {
    let connectionStatus: SpotifyManager.ConnectionStatus
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Circle()
                .fill(dotColor)
                .frame(width: 12, height: 12)
                .shadow(color: dotColor.opacity(0.6), radius: 4)
                .opacity(isPulsing ? 0.4 : 1.0)
                .animation(
                    isPulsing
                        ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                        : .default,
                    value: connectionStatus
                )
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
    }

    private var dotColor: Color {
        switch connectionStatus {
        case .connected: .green
        case .connecting: .yellow
        case .disconnected: .red
        }
    }

    private var isPulsing: Bool {
        connectionStatus == .connecting
    }

    private var accessibilityText: String {
        switch connectionStatus {
        case .connected: "Spotify connected"
        case .connecting: "Connecting to Spotify"
        case .disconnected: "Spotify disconnected. Tap to connect."
        }
    }
}
