//
//  Tally — the data-card tool on the phone that is already at the cleanup.
//
//  THE READING IS NOT IMPLEMENTED IN SWIFT AND SHOULD NEVER BE. Every figure in
//  HANDOFF.md -- registration, tally counting, digit recognition -- was measured
//  against the TypeScript in src/, on 1,606 pages, and a Swift port would be a
//  second implementation to keep in step with numbers that took months to
//  establish. What is native here is the interface. The pipeline runs in a
//  WKWebView with no interface attached: see Engine.swift and src/engine.ts.
//
//  So a fix to the reading is a change to src/ followed by ios/sync-web.sh. It
//  is never a change to anything under Tally/.
//
//  The eight screens are the design in `design_handoff_mobile_companion`,
//  recreated with the platform's own conventions -- NavigationStack, system
//  controls, SF Symbols in place of Phosphor -- rather than by porting the
//  prototype's markup. Its tokens are transcribed once, in Theme.swift.
//

import SwiftUI

@main
struct CleanupApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                // The keypad is drawn by this app rather than by the system, so
                // nothing here is ever covered by a keyboard. The event form on
                // screen 2 raises one, and scrolls itself.
                .ignoresSafeArea(.keyboard, edges: .bottom)
        }
    }
}
