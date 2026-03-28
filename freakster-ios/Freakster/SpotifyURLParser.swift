//
//  SpotifyURLParser.swift
//  Freakster
//

import Foundation

enum SpotifyURLParser {
    /// Converts a Spotify URL (e.g. "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=...")
    /// into a Spotify URI (e.g. "spotify:track:4iV5W9uYEdYUVa79Axb7Rh").
    /// Returns nil if the string is not a valid Spotify track URL.
    static func spotifyURI(from string: String) -> String? {
        // If it's already a spotify URI, return it directly
        if string.hasPrefix("spotify:track:") {
            let id = String(string.dropFirst("spotify:track:".count))
            guard isValidSpotifyID(id) else { return nil }
            return string
        }

        guard let url = URL(string: string),
              let host = url.host?.lowercased() else {
            return nil
        }

        // Accept open.spotify.com URLs
        guard host == "open.spotify.com" || host == "spotify.com" else {
            return nil
        }

        let pathComponents = url.pathComponents.filter { $0 != "/" }

        // Expected format: /track/{id} or /intl-xx/track/{id}
        guard pathComponents.count >= 2 else { return nil }

        // Find "track" in path components and take the next one as the ID
        guard let trackIndex = pathComponents.firstIndex(of: "track"),
              trackIndex + 1 < pathComponents.count else {
            return nil
        }

        let trackID = pathComponents[trackIndex + 1]
        guard isValidSpotifyID(trackID) else { return nil }

        return "spotify:track:\(trackID)"
    }

    private static func isValidSpotifyID(_ id: String) -> Bool {
        // Spotify IDs are 22-character base62 strings
        let base62 = CharacterSet.alphanumerics
        return id.count == 22 && id.unicodeScalars.allSatisfy { base62.contains($0) }
    }
}
