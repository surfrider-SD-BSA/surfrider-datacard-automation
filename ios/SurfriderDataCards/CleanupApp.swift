//
//  The iOS shell.
//
//  The reading itself is not reimplemented here and should never be. Every
//  figure in HANDOFF.md -- registration, tally counting, digit recognition --
//  was measured against the TypeScript in src/, and a Swift port would be a
//  second implementation to keep in step with it. This app is a window onto
//  that same bundle, running offline out of the app package.
//
//  What the shell adds is the three things a web page cannot do on iOS: load
//  its own assets under a scheme `fetch` will talk to, hand a finished
//  spreadsheet to the share sheet, and ask for the camera by name.
//

import SwiftUI

@main
struct CleanupApp: App {
    var body: some Scene {
        WindowGroup {
            WebScreen()
                // The card review list is a long scroll of crops and text
                // fields; the keyboard must not cover the field being typed
                // into, and the safe area must not cut off the last row.
                .ignoresSafeArea(.keyboard, edges: .bottom)
        }
    }
}
