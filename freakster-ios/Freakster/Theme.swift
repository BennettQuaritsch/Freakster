//
//  Theme.swift
//  Freakster
//
//  Brand tokens mirrored from freakster-web-svelte/src/routes/layout.css.
//  Web is upstream — OKLCH values converted to approximate sRGB here.
//

import SwiftUI

extension Color {
    // Background — near-black with warm rose undertone
    static let bg = Color(red: 0.118, green: 0.105, blue: 0.112) // oklch(0.12 0.008 350)

    // Rose primary scale
    static let brandPrimary       = Color(red: 0.831, green: 0.420, blue: 0.604) // oklch(0.65 0.16 350)
    static let brandPrimaryHover  = Color(red: 0.870, green: 0.474, blue: 0.651) // oklch(0.70 0.17 350)
    static let brandPrimaryActive = Color(red: 0.749, green: 0.376, blue: 0.541) // oklch(0.58 0.15 350)
    static let brandPrimaryMuted  = Color.brandPrimary.opacity(0.15)

    // Secondary — warm amber, complementary to rose
    static let brandSecondary      = Color(red: 0.910, green: 0.741, blue: 0.471) // oklch(0.78 0.12 75)
    static let brandSecondaryHover = Color(red: 0.949, green: 0.792, blue: 0.522) // oklch(0.83 0.13 75)

    // Text
    static let textPrimary    = Color(red: 0.934, green: 0.918, blue: 0.922) // oklch(0.93 0.006 350)
    static let textSecondary  = Color(red: 0.698, green: 0.682, blue: 0.690) // oklch(0.70 0.01 350)
    static let textOnPrimary  = Color(red: 0.129, green: 0.114, blue: 0.122) // oklch(0.13 0.008 350)

    // Surfaces — progressive lightening, rose-tinted
    static let surface1 = Color(red: 0.157, green: 0.143, blue: 0.150) // oklch(0.16 0.008 350)
    static let surface2 = Color(red: 0.196, green: 0.180, blue: 0.187) // oklch(0.19 0.009 350)
    static let surface3 = Color(red: 0.231, green: 0.215, blue: 0.222) // oklch(0.22 0.01 350)

    // Borders
    static let borderMuted  = Color(red: 0.255, green: 0.238, blue: 0.246) // oklch(0.25 0.01 350)
    static let borderSubtle = Color(red: 0.204, green: 0.188, blue: 0.196) // oklch(0.20 0.008 350)

    // Semantic status
    static let statusSuccess = Color(red: 0.420, green: 0.745, blue: 0.557) // oklch(0.72 0.15 155)
    static let statusWarning = Color(red: 0.910, green: 0.733, blue: 0.353) // oklch(0.78 0.15 75)
    static let statusCaution = Color(red: 0.835, green: 0.624, blue: 0.318) // oklch(0.72 0.14 55)
    static let statusError   = Color(red: 0.847, green: 0.388, blue: 0.376) // oklch(0.65 0.20 25)
}
