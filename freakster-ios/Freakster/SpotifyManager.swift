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

    private static let apiBaseURL: URL = {
        guard let raw = Bundle.main.infoDictionary?["FREAKSTER_API_BASE_URL"] as? String else {
            fatalError("FREAKSTER_API_BASE_URL not found in Info.plist. Did you set up Config.xcconfig?")
        }
        let trimmed = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\" /"))
        guard !trimmed.isEmpty, let url = URL(string: trimmed) else {
            fatalError("Invalid or empty FREAKSTER_API_BASE_URL: \(raw)")
        }
        return url
    }()

    private static let keychainService = "com.freakster.spotify"
    private static let accessTokenAccount = "access_token"
    private static let refreshTokenAccount = "refresh_token"
    private static let expiresAtAccount = "expires_at"

    private static let requestedScopes: SPTScope = [.appRemoteControl]

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
    @ObservationIgnored
    private lazy var sessionManager: SPTSessionManager = {
        SPTSessionManager(configuration: self.configuration, delegate: self)
    }()

    /// Track the last played URI to avoid re-triggering the same scan.
    private var lastPlayedURI: String?
    private var lastPlayedTime: Date?

    /// Set when play() arrives while the SDK socket is disconnected. Sent once
    /// `appRemoteDidEstablishConnection` fires.
    private var pendingPlayURI: String?

    private var intentionallyDisconnecting = false

    /// Single-flight guard so concurrent callers don't trigger multiple /refresh requests.
    private var refreshTask: Task<String?, Never>?

    // MARK: - Initialization

    override init() {
        configuration = SPTConfiguration(
            clientID: Self.clientID,
            redirectURL: Self.redirectURL
        )
        configuration.playURI = ""
        configuration.tokenSwapURL = Self.apiBaseURL.appendingPathComponent("api/spotify/ios/swap")

        appRemote = SPTAppRemote(configuration: configuration, logLevel: .debug)

        super.init()

        appRemote.delegate = self

        // Legacy migration: an install from before refresh-token support has only an
        // access_token in keychain. That token is useless without a refresh token; nuke
        // it so connect() drops cleanly into the SPTSessionManager flow.
        if keychainRetrieve(account: Self.accessTokenAccount) != nil,
           keychainRetrieve(account: Self.refreshTokenAccount) == nil {
            keychainDelete(account: Self.accessTokenAccount)
            keychainDelete(account: Self.expiresAtAccount)
            print("[Freakster] Cleared legacy access token (no refresh token paired); re-auth required")
        }

        // If we have a refresh_token cached, surface .connected immediately. The
        // actual SDK socket connects lazily on the first play().
        if keychainRetrieve(account: Self.refreshTokenAccount) != nil {
            connectionStatus = .connected
        }
    }

    // MARK: - Public Methods

    /// Entry point for the status-dot tap. If we already have a refresh token, ensures
    /// the access token is valid (silent refresh) and reports ready. Otherwise launches
    /// the one-time Spotify authorization flow.
    func connect() {
        Task { @MainActor in
            intentionallyDisconnecting = false
            lastError = nil

            if keychainRetrieve(account: Self.refreshTokenAccount) == nil {
                connectionStatus = .connecting
                print("[Freakster] No refresh token — starting Spotify authorization")
                sessionManager.initiateSession(
                    with: Self.requestedScopes,
                    options: .default,
                    campaign: nil
                )
                return
            }

            connectionStatus = .connecting
            if let token = await ensureValidAccessToken() {
                appRemote.connectionParameters.accessToken = token
                if !appRemote.isConnected {
                    appRemote.connect()
                } else {
                    connectionStatus = .connected
                }
            } else {
                // Refresh failed — likely invalid_grant. The refresh path already cleared
                // tokens; user can tap again to start a fresh auth flow.
                connectionStatus = .disconnected
                lastError = "Spotify session expired. Tap to reconnect."
            }
        }
    }

    /// User-initiated disconnect. Tears down the SDK socket and clears auth state.
    func disconnect() {
        intentionallyDisconnecting = true
        pendingPlayURI = nil
        if appRemote.isConnected {
            appRemote.disconnect()
        }
        connectionStatus = .disconnected
        lastError = nil
    }

    /// Handles the URL callback from Spotify after the authorization bounce.
    func handleURL(_ url: URL) {
        print("[Freakster] handleURL called with: \(url)")
        guard isSpotifyAuthCallbackURL(url) else {
            print("[Freakster] Ignoring non-Spotify callback URL")
            return
        }

        let handled = sessionManager.application(UIApplication.shared, open: url, options: [:])
        if !handled {
            print("[Freakster] SessionManager did not recognize the URL")
            connectionStatus = .disconnected
            lastError = "Invalid authorization response"
        }
    }

    /// Plays a Spotify track URI. Refreshes tokens and reconnects the SDK socket lazily
    /// if needed.
    func play(spotifyURI: String) {
        // Debounce: don't replay the same URI within 3 seconds.
        if let lastURI = lastPlayedURI,
           let lastTime = lastPlayedTime,
           lastURI == spotifyURI,
           Date.now.timeIntervalSince(lastTime) < 3.0 {
            return
        }
        lastPlayedURI = spotifyURI
        lastPlayedTime = .now

        Task { @MainActor in
            guard let token = await ensureValidAccessToken() else {
                connectionStatus = .disconnected
                lastError = "Spotify session expired. Tap to reconnect."
                return
            }

            appRemote.connectionParameters.accessToken = token

            if appRemote.isConnected {
                sendPlay(uri: spotifyURI)
            } else {
                pendingPlayURI = spotifyURI
                intentionallyDisconnecting = false
                appRemote.connect()
            }
        }
    }

    /// Called when the app becomes active. Pre-refreshes the token so the first scan
    /// after a long idle is snappy, but does not eagerly open the SDK socket.
    func sceneDidBecomeActive() {
        intentionallyDisconnecting = false
        Task { @MainActor in
            guard keychainRetrieve(account: Self.refreshTokenAccount) != nil else { return }
            _ = await ensureValidAccessToken()
        }
    }

    /// Called when the app resigns active. Cleanly tears down the SDK socket (Spotify's
    /// recommended behavior). Auth state stays put.
    func sceneWillResignActive() {
        intentionallyDisconnecting = true
        pendingPlayURI = nil
        if appRemote.isConnected {
            appRemote.disconnect()
        }
    }

    // MARK: - Token management

    @MainActor
    private func ensureValidAccessToken() async -> String? {
        if let token = currentAccessToken() {
            return token
        }

        if let inflight = refreshTask {
            return await inflight.value
        }

        let task = Task<String?, Never> { [weak self] in
            await self?.performRefresh() ?? nil
        }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }

    private func currentAccessToken() -> String? {
        guard let token = keychainRetrieve(account: Self.accessTokenAccount), !token.isEmpty else {
            return nil
        }
        guard let expiresAt = storedExpiresAt(), expiresAt.timeIntervalSinceNow > 30 else {
            return nil
        }
        return token
    }

    @MainActor
    private func performRefresh() async -> String? {
        guard let refreshToken = keychainRetrieve(account: Self.refreshTokenAccount), !refreshToken.isEmpty else {
            print("[Freakster] No refresh token; can't refresh")
            return nil
        }

        let url = Self.apiBaseURL.appendingPathComponent("api/spotify/ios/refresh")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "refresh_token=\(refreshToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
            .data(using: .utf8)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                print("[Freakster] Refresh: unexpected non-HTTP response")
                return nil
            }

            if http.statusCode == 400 || http.statusCode == 401 {
                // Refresh token is invalid/revoked — force a fresh auth.
                let body = String(data: data, encoding: .utf8) ?? "<binary>"
                print("[Freakster] Refresh rejected (\(http.statusCode)): \(body) — clearing stored tokens")
                clearStoredTokens()
                return nil
            }

            guard (200...299).contains(http.statusCode) else {
                let body = String(data: data, encoding: .utf8) ?? "<binary>"
                print("[Freakster] Refresh non-2xx (\(http.statusCode)): \(body)")
                return nil
            }

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let accessToken = json["access_token"] as? String,
                  let expiresIn = json["expires_in"] as? Int else {
                print("[Freakster] Refresh: malformed JSON body")
                return nil
            }

            keychainStore(accessToken, account: Self.accessTokenAccount)
            let expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn) - 60)
            keychainStore(String(expiresAt.timeIntervalSince1970), account: Self.expiresAtAccount)
            if let rotated = json["refresh_token"] as? String, !rotated.isEmpty {
                keychainStore(rotated, account: Self.refreshTokenAccount)
            }
            print("[Freakster] Refresh succeeded; access token good until \(expiresAt)")
            return accessToken
        } catch {
            print("[Freakster] Refresh network error: \(error.localizedDescription)")
            return nil
        }
    }

    private func storeSession(_ session: SPTSession) {
        keychainStore(session.accessToken, account: Self.accessTokenAccount)
        if !session.refreshToken.isEmpty {
            keychainStore(session.refreshToken, account: Self.refreshTokenAccount)
        }
        keychainStore(String(session.expirationDate.timeIntervalSince1970), account: Self.expiresAtAccount)
    }

    private func storedExpiresAt() -> Date? {
        guard let raw = keychainRetrieve(account: Self.expiresAtAccount),
              let interval = TimeInterval(raw) else {
            return nil
        }
        return Date(timeIntervalSince1970: interval)
    }

    private func clearStoredTokens() {
        keychainDelete(account: Self.accessTokenAccount)
        keychainDelete(account: Self.refreshTokenAccount)
        keychainDelete(account: Self.expiresAtAccount)
    }

    // MARK: - Playback

    private func sendPlay(uri: String) {
        appRemote.playerAPI?.play(uri) { [weak self] _, error in
            if let error {
                let errorMsg = error.localizedDescription
                print("[Freakster] Playback error: \(errorMsg)")
                Task { @MainActor in
                    self?.lastError = "Playback error: \(errorMsg)"
                }
            }
        }
    }

    // MARK: - Keychain Helpers

    private func keychainStore(_ value: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: account,
            kSecValueData as String: value.data(using: .utf8) ?? Data(),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("[Keychain] Failed to store \(account): \(status)")
        }
    }

    private func keychainRetrieve(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) {
            return token
        }

        if status != errSecItemNotFound {
            print("[Keychain] Failed to retrieve \(account): \(status)")
        }

        return nil
    }

    private func keychainDelete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccount as String: account,
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            print("[Keychain] Failed to delete \(account): \(status)")
        }
    }

    // MARK: - URL / error helpers

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
        path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func shouldClearStoredToken(for error: (any Error)?) -> Bool {
        guard let error else { return false }

        let message = error.localizedDescription.lowercased()
        return message.contains("token")
            || message.contains("auth")
            || message.contains("expired")
            || message.contains("401")
    }
}

// MARK: - SPTSessionManagerDelegate

extension SpotifyManager: SPTSessionManagerDelegate {
    func sessionManager(manager: SPTSessionManager, didInitiate session: SPTSession) {
        Task { @MainActor in
            print("[Freakster] SessionManager didInitiate; access token expires \(session.expirationDate)")
            self.storeSession(session)
            self.appRemote.connectionParameters.accessToken = session.accessToken
            self.intentionallyDisconnecting = false
            self.connectionStatus = .connecting
            self.appRemote.connect()
        }
    }

    func sessionManager(manager: SPTSessionManager, didRenew session: SPTSession) {
        Task { @MainActor in
            print("[Freakster] SessionManager didRenew; access token expires \(session.expirationDate)")
            self.storeSession(session)
            self.appRemote.connectionParameters.accessToken = session.accessToken
        }
    }

    func sessionManager(manager: SPTSessionManager, didFailWith error: any Error) {
        Task { @MainActor in
            print("[Freakster] SessionManager didFailWith: \(error.localizedDescription)")
            self.connectionStatus = .disconnected
            self.lastError = "Spotify authorization failed: \(error.localizedDescription)"
        }
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

            if let pending = self.pendingPlayURI {
                self.pendingPlayURI = nil
                self.sendPlay(uri: pending)
            }
        }
    }

    nonisolated func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: (any Error)?) {
        Task { @MainActor in
            if let error {
                print("[Freakster] Spotify disconnected: \(error.localizedDescription)")
            } else {
                print("[Freakster] Spotify disconnected")
            }

            // Idle drops are expected per Spotify's design. We don't reconnect proactively
            // and we don't surface the drop as an error — the next play() handles it lazily.
            // We only flip status away from .connected if we no longer have valid auth.
            if self.keychainRetrieve(account: Self.refreshTokenAccount) == nil {
                self.connectionStatus = .disconnected
            }
        }
    }

    nonisolated func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: (any Error)?) {
        Task { @MainActor in
            let hadPendingPlay = self.pendingPlayURI != nil
            self.pendingPlayURI = nil

            if let error {
                print("[Freakster] Spotify connection failed: \((error as NSError).domain) \((error as NSError).code) — \(error.localizedDescription)")
            } else {
                print("[Freakster] Spotify connection failed (no error details)")
            }

            if self.shouldClearStoredToken(for: error) {
                self.clearStoredTokens()
                self.connectionStatus = .disconnected
                self.lastError = "Spotify session expired. Tap to reconnect."
                return
            }

            if hadPendingPlay {
                self.lastError = "Couldn't reach Spotify. Make sure Spotify is open on your phone, then try again."
            } else {
                // Background reconnect attempt failed. Stay in current status; don't yell at user.
            }
        }
    }
}
