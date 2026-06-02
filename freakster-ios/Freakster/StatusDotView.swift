//
//  StatusDotView.swift
//  Freakster
//

import SwiftUI

struct StatusDotView: View {
    enum Style {
        case compact
        case inline
    }

    let connectionStatus: SpotifyManager.ConnectionStatus
    var style: Style = .inline
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            switch style {
            case .compact: compactBody
            case .inline:  inlineBody
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
    }

    private var compactBody: some View {
        dot
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }

    private var inlineBody: some View {
        HStack(spacing: 10) {
            dot
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Color.textPrimary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var dot: some View {
        Circle()
            .fill(dotColor)
            .frame(width: 10, height: 10)
            .shadow(color: dotColor.opacity(0.6), radius: 4)
            .opacity(isPulsing ? 0.4 : 1.0)
            .animation(
                isPulsing
                    ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                    : .default,
                value: connectionStatus
            )
    }

    private var dotColor: Color {
        switch connectionStatus {
        case .connected:    .statusSuccess
        case .connecting:   .statusWarning
        case .disconnected: .statusError
        }
    }

    private var isPulsing: Bool {
        connectionStatus == .connecting
    }

    private var label: String {
        switch connectionStatus {
        case .connected:    "Connected"
        case .connecting:   "Connecting…"
        case .disconnected: "Tap to connect"
        }
    }

    private var accessibilityText: String {
        switch connectionStatus {
        case .connected:    "Spotify connected"
        case .connecting:   "Connecting to Spotify"
        case .disconnected: "Spotify disconnected. Tap to connect."
        }
    }
}
