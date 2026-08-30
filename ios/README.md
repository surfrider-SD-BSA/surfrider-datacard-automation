# Tally — the iOS app

The data-card tool on the phone that is already at the cleanup. Eight screens in
SwiftUI, over the same reading pipeline the browser tool runs.

**Picking this up? Start with [HANDOFF.md](HANDOFF.md)** — what is proven, what is
assumed, the settings and what they are measured to be worth, the three places the
design was deliberately not followed, and the traps. This file is how to build and
sign it; that one is why it is the way it is.

## What is native and what is not

**The interface is native. The reading is not, and should never be.**

Registration, tally counting and digit recognition are measured in `HANDOFF.md`
against the TypeScript in `src/`, on 1,606 pages. A Swift port would be a second
implementation to keep in step with a set of figures that took months to
establish, and the first time the two drifted nobody would know which one the
numbers described. So the pipeline runs unchanged, in a WKWebView with no
interface attached:

| Piece | Where it lives |
| --- | --- |
| The eight screens, navigation, keypad, drafts | `SurfriderDataCards/Tally/` |
| The bridge to the pipeline | `Tally/Engine.swift` ⇄ `src/engine.ts` |
| Rasterizing, registration, cells, marks, digits, xlsx | `src/lib/`, untouched |

**A fix to the reading is a change to `src/`, followed by `ios/sync-web.sh`. It
is never a change to anything under `Tally/`.**

The design the screens come from is `design_handoff_mobile_companion` in the
Claude Design project, recreated with the platform's own conventions --
`NavigationStack`, system controls, SF Symbols in place of Phosphor -- rather
than by porting the prototype's markup. Its tokens are transcribed once, in
`Tally/Theme.swift`, and nothing else writes a colour literal.

## The bridge

`engine.html` is a second Vite entry point: `src/engine.ts` with an empty body.
Swift calls `window.tally.dispatch(json)` and every answer comes back through
`webkit.messageHandlers.tally`, because `evaluateJavaScript` cannot return a
promise. Five methods: `open`, `process`, `crop`, `export`, `reset`.

Two things deliberately do not cross the bridge.

**Page images.** A letter page at 200 DPI is 3.7MB of grayscale and a 116-page
scan is 430MB of them. They are cut into row crops in the page and dropped, and
Swift asks for one cell picture at a time by card and row.

**The scan.** It goes the other way, as a resource rather than a string:
`WebAssetSchemeHandler` stages the file under a one-shot token and the page
fetches `/__inbox/<token>`. Base64 through `evaluateJavaScript` would be the
whole scan as a JavaScript string literal, parsed by JavaScriptCore, on a phone.

## What the shell still adds

**Its own origin.** The page fetches the reference card, the cell maps and the
3.4MB digit model with `fetch()`. WKWebView refuses cross-origin fetches from
`file://`, so all of them fail and the app opens to a tool that cannot read
anything. `WebAssetSchemeHandler` serves the bundle under a `cleanup://` scheme,
which is treated as a proper origin, and the page runs unchanged.

Watch the MIME types there. `pdf.worker.min.mjs` served as anything but a
JavaScript type is rejected by the module loader, and the app then hangs while
reading with nothing in the console, because the failure is inside a worker
nobody is watching.

**Getting the spreadsheet out.** The engine hands back workbook bytes, Swift
writes them to a temp file, and the share sheet takes it from there -- Files,
AirDrop, Mail -- which is how a file leaves an app on iOS anyway. The old
`<a download>` interception is gone with the web interface it belonged to.

## Two ways in: the camera, and a scan

Screen 3 offers both, as two separate buttons, because they are two different
jobs: photographing the cards at the cleanup, and picking up a PDF somebody made
on the chapter's scanner.

**The camera came back on 22 August 2026, and how it came back is the point.**
Image input had been removed earlier, along with `NSCameraUsageDescription`, on
an objection that was correct: a photograph held at an angle keystones, and
registration corrects rotation and scale but not that. What answers it is that
capture does not go through a camera. `VNDocumentCameraViewController` finds the
page's four corners and **rectifies the perspective** before the image is handed
over, so the pipeline receives a flat page. See `Tally/DocumentScanner.swift`.

The captured pages are bound into a PDF and fed to the same `read(pdf:)` the
picker uses. A PDF rather than a new engine entry point on purpose: everything
downstream is measured on 1,606 pages of exactly that input. `CapturedPages.pdf`
lays each page out at `pixels * 72/200` points, so that rasterizing at 200 DPI
returns precisely the pixels the camera captured rather than a resampling of
them -- get that wrong and the resolution this path exists to preserve is thrown
away on the way in.

`NSPhotoLibraryUsageDescription` is still deliberately absent. Nothing reads the
library or writes to it.

**What is still unmeasured is resolution**, and it is the one number that
decides whether this is worth having. The pipeline expects 200 DPI on the card's
short edge; whether a handheld capture clears that in beach light has never been
tested on a real card, and the design handoff calls it "the biggest open risk in
the whole concept". **Measure it on a real card before telling a chapter to rely
on it.**

**So the button is gated.** `Beta.cameraCapture`, at the top of
`Tally/Screens/CaptureScreen.swift`, decides whether it is offered at all, and
it carries a BETA tag on the control itself when it is. Nothing is wrong with
the code -- the rectification is right and the page-size arithmetic is right --
so it is not deleted; what is missing is the measurement, and an unmeasured
input should not sit beside the scanner as though the two were equal. Turn it
off for a build going to volunteers typing up a real cleanup. With it off, the
picker becomes the screen's primary action and the hint stops mentioning the
camera.

When the resolution has been measured on a real card, take the gate out and let
it be an ordinary button.

## The share sheet

**Data Cards is a destination in the iOS share sheet.** Share a scan from Files,
Mail, Drive, or a scanner app, and the app is in the row of icons; the extension
copies the PDF across and it is waiting on screen 3 the next time the app is
opened.

There are two separate mechanisms here and they are easy to confuse:

- **The document type** in `Info.plist` (`CFBundleDocumentTypes`) is what puts
  *"Copy to Data Cards"* in the **list below** the icon row, and what handles
  *Open in* from apps that offer it. It has been there since the beginning and is
  unchanged. It only works for apps that hand over a real file, and the list is
  where things go to be scrolled past.
- **The share extension** (`SurfriderDataCards/Share/`) is what puts the app in
  the **icon row itself**. That is the whole reason it exists.

**It does not read the scan.** An extension is given a fraction of the app's
memory and is killed without ceremony when it exceeds it, and the pipeline in
`Engine.swift` is a WKWebView holding the reference card, the cell maps and the
digit model. So the extension copies one PDF and says so; `read(pdf:)` runs in
the app, from screen 3, exactly as it does for a file chosen from the picker.

**One PDF, and only a PDF.** `NSExtensionActivationRule` is a predicate rather
than the usual `…SupportsFileWithMaxCount` dictionary, because that dictionary
form offers this app for every file type on the phone and then says *"that is not
a PDF"* after the tap has been spent. A cleanup is one PDF, front and back in
card order, and the rule says exactly that.

### How the file crosses

An extension is a separate process with a separate container, so an App Group is
the only supported way across. `Shared/SharedInbox.swift` is the whole of it:
the extension writes a copy into `Inbox/` in the group container, and the app
moves it out and deletes the original the next time it becomes active
(`TallyModel.takeShared`, called from `RootView`). **The drawer is empty between
the share and the read**, and `sweep` throws away anything a week old, because a
shared container that quietly accumulated old cleanups would break the second
half of the promise every screen makes.

The group identifier is written in exactly one place — `APP_GROUP_ID` in the
project's build settings, which is `group.$(APP_BUNDLE_ID)`. Both `Info.plist`
files carry it into the bundle as `AppGroupIdentifier` and both `.entitlements`
files expand it. Do not type it anywhere else: two halves pointed at different
drawers fails silently and looks exactly like the share doing nothing.

`datacards://inbox` is the extension's attempt to bring the app forward after it
has written the file. It is only ever a nudge — `NSExtensionContext.open` is
documented for Today extensions and may simply report failure from here, and the
responder-chain trick around that is the kind of thing that passes review until
it does not. The scan arrives either way; without it the volunteer opens the app
themselves, which is one tap.

### What this costs at signing time

The app is now **two bundles**, `$(APP_BUNDLE_ID)` and `$(APP_BUNDLE_ID).Share`,
and both need the **App Groups** capability on `group.$(APP_BUNDLE_ID)`.
`testflight.sh` passes `-allowProvisioningUpdates`, which creates the second App
ID and the group on the first run; without it the archive fails at signing with
a missing-entitlement error that does not mention capabilities.

It also passes `APP_BUNDLE_ID=` rather than `PRODUCT_BUNDLE_IDENTIFIER=`. A
setting given on the `xcodebuild` command line applies to *every* target, and
handing the app and its extension the same identifier produces an archive App
Store Connect rejects.

**On an unsigned simulator build the App Group is not there** — entitlements are
not applied when `CODE_SIGNING_ALLOWED=NO`, so `SharedInbox.directory` is nil and
the extension says so rather than failing quietly. That is the ordinary state of
the build command below, and it is why the drawer does nothing there.

A team is not needed to exercise it, though. Signing the simulator build ad hoc
is enough — the simulator does not check the entitlement against a provisioning
profile, so the group container exists:

```sh
xcodebuild -project ios/SurfriderDataCards.xcodeproj -scheme "Data Cards" \
  -sdk iphonesimulator -derivedDataPath ios/build-adhoc \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" build
xcrun simctl install booted "ios/build-adhoc/Build/Products/Debug-iphonesimulator/Data Cards.app"
xcrun simctl get_app_container booted com.mateobesse.datacards group.com.mateobesse.datacards
```

The last line prints the drawer. Dropping a file into its `Inbox/` named
`<uuid>__scan.pdf` — which is exactly what `SharedInbox.deposit` writes — and
launching or foregrounding the app is the whole of the app's half of the
hand-off, without going near the share sheet. `pluginkit -m -p
com.apple.share-services` inside `simctl spawn booted` is how to check the
extension registered at all.

## Building it

```sh
./ios/sync-web.sh                 # rebuild dist/ and copy it into the app
open ios/SurfriderDataCards.xcodeproj
```

`ios/SurfriderDataCards/web/` is generated and gitignored. The project will not
build until `sync-web.sh` has been run at least once, and it should be run again
after any change to `src/` — an app built against a stale bundle looks like a
reading regression and is not one.

From the command line:

```sh
xcodebuild -project ios/SurfriderDataCards.xcodeproj -scheme "Data Cards" \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

This needs the iOS platform installed, which a stock Xcode does not include:

```sh
xcodebuild -downloadPlatform iOS
```

## Getting it onto a phone

There are two routes and they are not the same amount of work.

### The 7-day route, today, free

Xcode will sign an app with a plain Apple ID and install it on a device plugged
into this Mac. It expires after seven days and has to be reinstalled, which is
fine for looking at it and useless for a volunteer at a cleanup.

Open `ios/SurfriderDataCards.xcodeproj`, select the target, Signing &
Capabilities, add your Apple ID under Team, plug in the phone and press Run.

This has been done: a personal team signs `com.mateobesse.datacards`, and the app
installs and launches on a physical iPhone. The same thing from the command line,
with the phone plugged in, unlocked and trusted:

```sh
xcrun devicectl list devices          # copy the connected phone's identifier

./ios/sync-web.sh
xcodebuild -project ios/SurfriderDataCards.xcodeproj -scheme "Data Cards" \
  -destination 'id=PUT-DEVICE-ID-HERE' \
  -allowProvisioningUpdates -derivedDataPath ios/build build
xcrun devicectl device install app --device PUT-DEVICE-ID-HERE \
  "ios/build/Build/Products/Debug-iphoneos/Data Cards.app"
```

A phone that has never had a development build on it also needs Developer Mode
turned on under Settings -> Privacy & Security, and the certificate trusted under
Settings -> General -> VPN & Device Management.

### TestFlight

`ios/testflight.sh` does the whole build and upload. What it cannot do is be
you: **every blocker here is an account, not a line of code.** A free personal
team now signs development builds for a plugged-in phone, but that is not a
TestFlight credential. There is still no paid membership, no distribution
certificate and no App Store Connect key on this machine, and without them
archiving fails with "Signing for Data Cards requires a development team".

What you have to do once:

1. **Apple Developer Program membership**, $99/year. TestFlight is not available
   on a free account.
2. **Pick a bundle identifier you own** and register an App ID for it. The
   project currently uses `com.mateobesse.datacards`, which is personal -- for a
   chapter build it should sit under a domain the chapter controls.
3. **Create the app record** in App Store Connect with that bundle ID.
4. **Generate an App Store Connect API key** with the App Manager role, and put
   the `AuthKey_XXXXXXXX.p8` in `~/.appstoreconnect/private_keys/`. Do not
   commit it. Nothing in this repository should ever contain it.

Then:

```sh
export TEAM_ID=ABCDE12345
export BUNDLE_ID=org.yourdomain.datacards
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
./ios/testflight.sh
```

The script refreshes the web bundle, archives, exports a signed `.ipa`,
validates it, and uploads. Build numbers come from the clock, because App Store
Connect refuses a `CFBundleVersion` it has already seen rather than replacing
it.

**Internal testers** -- up to 100 people on your team -- get the build as soon
as it finishes processing, with no review. **External testers** need Beta App
Review first, which is a day or so and does look at the app.

## What has NOT been done

- **The SwiftUI app compiles clean** against the iOS Simulator SDK, with no
  warnings. The bridge protocol is verified from the other end: `open` loads
  the reference card, the cell maps and the digit model, and success, failure
  and unknown-method replies all come back correctly addressed.
- **Reading a card INSIDE the app has not been exercised.** Doing that means
  driving the file picker, which nothing here automates. So the PDF path is
  proven on the web side -- and through `scripts/run-shipping-path.mjs`, which
  runs real pages through the shipping modules offline -- and assumed here.
  **Load a card as the first thing you do**, and if it hangs while reading with
  nothing in the console, the MIME type note above is where to look.
- **No screen has been seen on a device.** The layout is transcribed from the
  handoff's measurements rather than checked against a running app, so expect
  to nudge spacing. The values to nudge are all in `Tally/Theme.swift`.
- **Development signing only.** A free personal team signs
  `com.mateobesse.datacards`, and Xcode issues a provisioning profile that
  expires seven days after it is created, so the app stops launching a week after
  each install. There is no paid membership, no distribution certificate and no
  identifier the chapter owns, so TestFlight is still out of reach.
- **No custom launch screen.** `UILaunchScreen` is an empty dict, which takes the
  system default. There is an app icon, generated by `ios/make-icon.mjs`.
- **Nothing measured on phone photographs.** Capture is built and rectifies
  perspective, but no one has checked what DPI a real card actually lands at.
  See "Two ways in" above. The thing to do about it is a measurement, not a
  feature.
- **Nothing in the app has been exercised end to end.** It builds, signs,
  installs and launches on a physical iPhone. Reading a card INSIDE the app --
  from either input -- has not been driven by anything automated, so the
  pipeline is proven on the web side and assumed here. **Load a card as the
  first thing you do.** If it hangs on "Reading the cards" with the bar at
  zero, the MIME-type note above is where to look.
