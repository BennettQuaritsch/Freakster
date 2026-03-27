//
//  SpotifyManager.swift
//  Freakster
//

import Foundation
import Security
import SpotifyiOS
import UIKit

@Observable
final class SpotifyManager: NSObject {
    // MARK: - Configuration

    private static let clientID: String = {
        guard let raw = Bundle.main.infoDictionary?["SPOTIFY_CLIENT_ID"] as? String else {
            fatalError("SPOTIFY_CLIENT_ID not found in Info.plist. Did you set up Config.xcconfig?")
        }

        let id = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
        guard !id.isEmpty else {
            fatalError("SPOTIFY_CLIENT_ID is empty after trimming. Check Config.xcconfig format.")
        }
        return id
    }()

    private static let redirectURL: URL = {
        guard let urlString = Bundle.main.infoDictionary?["SPOTIFY_REDIRECT_URL"] as? String,
              let url = URL(string: urlString) else {
            fatalError("Invalid or missing SPOTIFY_REDIRECT_URL in Info.plist")
        }
        return url
    }()

    private static let keychainService = "com.freakster.spotify"
    private static let keychainAccount = "access_token"

    // MARK: - Published State

    enum ConnectionStatus {
        case disconnected
        case connecting
        case connected
    }

    private(set) var connectionStatus: ConnectionStatus = .disconnected
    private(set) var lastError: String?

    // MARK: - Private Properties

    private let configuration: SPTConfiguration
    private var appRemote: SPTAppRemote

    private var accessToken: String? {
        get { keychainRetrieve() }
        set {
            if let token = newValue {
                keychainStore(token)
            } else {
                keychainDelete()
            }
        }
    }

    /// Track the last played URI to avoid re-triggering the same scan
    private var lastPlayedURI: String?
    private var lastPlayedTime: Date?
    private var didAttemptTokenConnect = false
    private var didAttemptAuthFallback = false
    private var intentionallyDisconnecting = false

    // MARK: - Initialization

    override init() {
        configuration = SPTConfiguration(
            clientID: Self.clientID,
            redirectURL: Self.redirectURL
        )
        configuration.playURI = ""

        appRemote = SPTAppRemote(configuration: configuration, logLevel: .debug)

        super.init()

        appRemote.delegate = self
    }

    // MARK: - Public Methods

    /// Initiates the Spotify authorization flow. Opens the Spotify app briefly.
    func connect() {
        lastError = nil
        didAttemptAuthFallback = false

        if let token = accessToken, !token.isEmpty {
            connectionStatus = .connecting
            didAttemptTokenConnect = true
            print("[Freakster] Connecting with stored token")
            appRemote.connectionParameters.accessToken = token
            appRemote.connect()
            return
        }

        didAttemptTokenConnect = false
        startAuthorizationFlow()
    }

    /// Disconnects from the Spotify app remote.
    func disconnect() {
        intentionallyDisconnecting = true
        if appRemote.isConnected {
            appRemote.disconnect()
        }
        connectionStatus = .disconnected
        lastError = nil
    }

    /// Handles the URL callback from Spotify after authorization.
    func handleURL(_ url: URL) {
        print("[Freakster] handleURL called with: \(url)")
        guard isSpotifyAuthCallbackURL(url) else {
            print("[Freakster] Ignoring non-Spotify callback URL")
            return
        }

        guard let parameters = appRemote.authorizationParameters(from: url) else {
            print("[Freakster] No authorization parameters found in URL")
            connectionStatus = .disconnected
            lastError = "Invalid authorization response"
            return
        }

        if let token = parameters[SPTAppRemoteAccessTokenKey] {
            print("[Freakster] Got access token from callback")
            accessToken = token
            appRemote.connectionParameters.accessToken = token
            connectionStatus = .connecting
            appRemote.connect()
            lastError = nil
        } else if let errorDesc = parameters[SPTAppRemoteErrorDescriptionKey] {
            print("[Freakster] Auth error: \(errorDesc)")
            connectionStatus = .disconnected
            lastError = formatAuthorizationError(from: url, description: errorDesc)
        } else {
            print("[Freakster] Callback had no token or error")
            connectionStatus = .disconnected
            lastError = "Unexpected authorization response"
        }
    }

    /// Plays a Spotify track URI immediately.
    func play(spotifyURI: String) {
        // Debounce: don't replay the same URI within 3 seconds
        if let lastURI = lastPlayedURI,
           let lastTime = lastPlayedTime,
           lastURI == spotifyURI,
           Date.now.timeIntervalSince(lastTime) < 3.0 {
            return
        }

        lastPlayedURI = spotifyURI
        lastPlayedTime = .now

        appRemote.playerAPI?.play(spotifyURI, callback: { [weak self] _, error in
            if let error {
                let errorMsg = error.localizedDescription
                print("Playback error: \(errorMsg)")
                Task { @MainActor in
                    self?.lastError = "Playback error: \(errorMsg)"
                }
            }
        })
    }

    /// Called when the app becomes active — reconnects to Spotify.
    func sceneDidBecomeActive() {
        intentionallyDisconnecting = false
        guard !appRemote.isConnected else { return }
        guard let token = accessToken, !token.isEmpty else { return }
        guard connectionStatus != .connecting else { return }

        print("[Freakster] App became active, reconnecting with stored token")
        connectionStatus = .connecting
        appRemote.connectionParameters.accessToken = token
        appRemote.connect()
    }

    /// Called when the app resigns active — disconnects.
    func sceneWillResignActive() {
        intentionallyDisconnecting = true
        if appRemote.isConnected {
            appRemote.disconnect()
        }
    }

    // MARK: - Keychain Helper Methods

    private func keychainStore(_ token: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecValueData as String: token.data(using: .utf8) ?? Data(),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        // Delete any existing item first
        SecItemDelete(query as CFDictionary)

        // Add the new item
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("[Keychain] Failed to store token: \(status)")
        }
    }

    private func keychainRetrieve() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
            kSecReturnData as String: true,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) {
            return token
        }

        if status != errSecItemNotFound {
            print("[Keychain] Failed to retrieve token: \(status)")
        }

        return nil
    }

    private func keychainDelete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: Self.keychainAccount,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            print("[Keychain] Failed to delete token: \(status)")
        }
    }

    private func startAuthorizationFlow() {
        let spotifyURL = URL(string: "spotify://")!
        guard UIApplication.shared.canOpenURL(spotifyURL) else {
            connectionStatus = .disconnected
            lastError = "Spotify app is not installed on this device"
            print("[Freakster] Spotify app not available")
            return
        }

        connectionStatus = .connecting
        didAttemptTokenConnect = false
        print("[Freakster] Starting authorization flow")
        appRemote.authorizeAndPlayURI("") { [weak self] spotifyInstalled in
            print("[Freakster] authorizeAndPlayURI returned: \(spotifyInstalled)")
            guard let self else { return }
            if !spotifyInstalled {
                self.connectionStatus = .disconnected
                self.lastError = "Spotify app is not installed on this device"
            }
        }
    }

    private func isSpotifyAuthCallbackURL(_ url: URL) -> Bool {
        let redirectURL = Self.redirectURL
        guard url.scheme?.lowercased() == redirectURL.scheme?.lowercased() else {
            return false
        }

        if let expectedHost = redirectURL.host?.lowercased(),
           !expectedHost.isEmpty,
           url.host?.lowercased() != expectedHost {
            return false
        }

        let expectedPath = normalizedRedirectPath(redirectURL.path)
        let incomingPath = normalizedRedirectPath(url.path)
        return expectedPath == incomingPath
    }

    private func normalizedRedirectPath(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return trimmed
    }

    private func shouldClearStoredToken(for error: (any Error)?) -> Bool {
        guard let error else { return false }

        let message = error.localizedDescription.lowercased()
        return message.contains("token")
            || message.contains("auth")
            || message.contains("expired")
            || message.contains("401")
    }

    private var shouldSurfaceDisconnectError: Bool {
        guard !intentionallyDisconnecting else { return false }
        return UIApplication.shared.applicationState == .active
    }

    private func formatAuthorizationError(from url: URL, description: String) -> String {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let errorCode = components?.queryItems?.first(where: { $0.name == "error" })?.value?.lowercased()

        guard errorCode == "unknown_error" else {
            return description
        }

        return "Spotify authorization failed (unknown_error). Check Spotify Dashboard settings: exact redirect URI, app in Development Mode with your account whitelisted, and a Premium Spotify account."
    }
}

// MARK: - SPTAppRemoteDelegate

extension SpotifyManager: SPTAppRemoteDelegate {
    nonisolated func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        Task { @MainActor in
            self.intentionallyDisconnecting = false
            self.connectionStatus = .connected
            self.lastError = nil
            print("[Freakster] Spotify connected")
        }
    }

    nonisolated func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: (any Error)?) {
        Task { @MainActor in
            self.connectionStatus = .disconnected
            if let error, self.shouldSurfaceDisconnectError {
                self.lastError = "Disconnected: \(error.localizedDescription)"
                print("[Freakster] Spotify disconnected: \(error.localizedDescription)")
            } else {
                self.lastError = nil
                print("[Freakster] Spotify disconnected")
            }
        }
    }

    nonisolated func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: (any Error)?) {
        Task { @MainActor in
            self.connectionStatus = .disconnected

            if self.shouldClearStoredToken(for: error) {
                self.accessToken = nil
                print("[Freakster] Cleared stored token due to auth-related error")
            }

            if self.didAttemptTokenConnect && !self.didAttemptAuthFallback {
                self.didAttemptAuthFallback = true
                self.accessToken = nil
                print("[Freakster] Stored-token connect failed, retrying with fresh authorization")
                self.startAuthorizationFlow()
                return
            }

            if let error {
                let errorMsg = "Connection failed: \(error.localizedDescription)"
                self.lastError = errorMsg
                print("[Freakster] Spotify connection failed")
                print("[Freakster] Error: \(error)")
                print("[Freakster] Error domain: \((error as NSError).domain)")
                print("[Freakster] Error code: \((error as NSError).code)")
            } else {
                self.lastError = "Connection failed"
                print("[Freakster] Spotify connection failed (no error details)")
            }
        }
    }
}
