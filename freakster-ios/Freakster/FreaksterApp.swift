//
//  FreaksterApp.swift
//  Freakster
//

import SwiftUI

@main
struct FreaksterApp: App {
    @State private var spotifyManager = SpotifyManager()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(spotifyManager: spotifyManager)
                .onOpenURL { url in
                    spotifyManager.handleURL(url)
                }
                .onChange(of: scenePhase) {
                    switch scenePhase {
                    case .active:
                        spotifyManager.sceneDidBecomeActive()
                    case .background:
                        spotifyManager.sceneWillResignActive()
                    case .inactive:
                        break
                    @unknown default:
                        break
                    }
                }
        }
    }
}
