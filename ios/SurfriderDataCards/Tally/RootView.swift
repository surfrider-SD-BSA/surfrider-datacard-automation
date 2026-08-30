//
//  The push stack.
//
//  A NavigationStack and nothing else: no tab bar, and no screen-jump list --
//  that was a prototype affordance in the design file and the handoff says so
//  explicitly. Back pops.
//

import SwiftUI

struct RootView: View {
    // The engine is built with the model and reached through it. One instance
    // for the life of the app: it holds the reference card, the cell maps and
    // the digit model, and re-reading those per scan would be several seconds
    // each time for nothing.
    @StateObject private var model = TallyModel(engine: Engine())
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $model.path) {
            CleanupsScreen(model: model, finished: model.finished)
                .navigationDestination(for: Screen.self) { screen in
                    switch screen {
                    case .event: EventScreen(model: model)
                    case .capture: CaptureScreen(model: model)
                    case .reading: ReadingScreen(model: model, engine: model.engine)
                    case .refused: RefusedScreen(model: model)
                    case .review: ReviewScreen(model: model)
                    case .cards: CardsScreen(model: model)
                    case .finish: FinishScreen(model: model)
                    }
                }
        }
        .tint(Nocturne.accent)
        .preferredColorScheme(.dark)
        .background(Nocturne.ground.ignoresSafeArea())
        .overlay(alignment: .topLeading) {
            // The engine's web view. One point, invisible, and in the window on
            // purpose -- see the note at the top of Engine.swift.
            model.engine.host
                .frame(width: 1, height: 1)
                .opacity(0)
                .allowsHitTesting(false)
        }
        .task {
            // A cold launch: `onChange` below does not fire for the value the
            // scene starts at, so the drawer is checked here as well. Before
            // the await, because a scan shared a moment ago is why the app is
            // being opened at all.
            model.takeShared()

            // Warm the reference card, the cell maps and the digit model while
            // the volunteer is still on the first screen. A few megabytes off
            // local storage, and it means the reading starts the moment a scan
            // arrives rather than a second later.
            await model.engine.open()
        }
        .onOpenURL { url in
            if url.isFileURL {
                // A PDF sent to the app from Files, Mail, Messages or AirDrop.
                // The other way in besides the two buttons on screen 3.
                model.openExternal(url)
            } else {
                // `datacards://inbox`, from the share extension. It carries no
                // file and does not need to -- the PDF is already in the App
                // Group drawer and the line below is what fetches it. The URL
                // only brings the app forward, and is allowed to never arrive.
                model.takeShared()
            }
        }
        .onChange(of: scenePhase) { phase in
            // The draft is debounced while typing. Going to the background is
            // the one moment that gap matters, so it is closed here.
            if phase != .active { model.flush() }

            // Coming back is the other moment that matters: the share sheet
            // runs in its own process, so a scan can appear in the drawer while
            // this app is suspended, with nothing to announce it.
            if phase == .active { model.takeShared() }
        }
    }
}
