# Tally — the Android app

The data-card tool on the phone that is already at the cleanup, for the half of
the volunteers who do not carry an iPhone. The same eight screens as
[the iOS app](../ios/README.md), in Jetpack Compose, over the same reading
pipeline the browser tool runs.

**Read [`ios/HANDOFF.md`](../ios/HANDOFF.md) as well as this.** Every decision
it records about the product — pre-fill kept against the design, a page refused
rather than cropped from, the keypad replacing a machine reading on the first
digit, the draft offered and never restored unasked — holds here unchanged,
because this app is a port of that one and not a second design. This file is
what is different about Android, how to build it, and what has been proven.

## What is native and what is not

**The interface is native. The reading is not, and should never be** — the
same rule as iOS, for the same reason. Registration, tally counting and digit
recognition are measured against the TypeScript in `src/` on 1,606 pages. A
Kotlin port would be a second implementation (a third, counting the one iOS
refused to write) of figures that took months to establish.

| Piece | Where it lives |
| --- | --- |
| The eight screens, navigation, keypad, drafts | `app/src/main/java/.../tally/` |
| The bridge to the pipeline | `tally/Engine.kt` ⇄ `src/engine.ts` |
| Serving the bundle to the WebView | `tally/WebAssets.kt` |
| Rasterizing, registration, cells, marks, digits, xlsx | `src/lib/`, untouched |

**A fix to the reading is a change to `src/`, followed by `android/sync-web.sh`
(and `ios/sync-web.sh`). It is never a change to anything under `android/`.**

The screens are the iOS screens, screen for screen and word for word. Where
the Swift branches on Liquid Glass, this takes the flat path, which is the
design as the handoff specified it. The tokens are in `tally/Theme.kt`,
transcribed from the same handoff as `Theme.swift`, and nothing else writes a
colour literal.

## The bridge

`src/engine.ts` is driven exactly as on iOS: Kotlin calls
`window.tally.dispatch(json)` and the page answers with `postMessage(string)`.
The only change the Android app needed on the web side is the name of the
mailbox — `post()` in `engine.ts` now uses `window.tallyAndroid` when there is
no `webkit.messageHandlers.tally`. On Android that object is a
`WebMessageListener` **scoped to the app's own origin**, so no other page could
post an answer; on a WebView too old for one, a `@JavascriptInterface` with the
same shape.

Two things still do not cross the bridge, for the reasons in `ios/README.md`:
page images (the page is cut into crops in the engine and dropped; Kotlin asks
for one cell's picture at a time) and the scan itself (staged under a one-shot
token and fetched by the page as `/__inbox/<token>`, not sent as a string).

**Its own origin.** WKWebView needed a custom `cleanup://` scheme so the page's
`fetch()` calls would work. Android reserves `https://appassets.androidplatform.net`
for this: a real https origin that never touches the network, answered from the
APK by `WebAssets.kt`. MIME types are set by hand there for the same reason as
on iOS — `pdf.worker.min.mjs` served as anything but JavaScript kills the PDF
worker silently, and the app hangs on "Reading the cards" with nothing in the log.

**The WebView is in the window.** One pixel, invisible, planted by `TallyApp.kt`.
Chromium throttles timers in a WebView that is not attached, and
`rasterizePdf` yields between pages with `setTimeout`.

**When the system kills it.** Android may kill the WebView's render process
under memory pressure, which on a large scan is not hypothetical. Unhandled,
that takes the app down with it. `Engine.rendererGone` drops the dead view,
fails whatever was waiting with a sentence a volunteer can act on, starts a
fresh one, and tells the model — which flushes the draft and says on screens 6
and 7 that the pictures are gone and the typing is not.

## The app has no INTERNET permission

**This is the most important difference from iOS, and it is deliberate.**
"The scan stays on this phone" is the promise every screen makes. On Android it
can be enforced by the operating system rather than by the app being careful:
without `android.permission.INTERNET` the app cannot open a socket, and its
WebView is forced to refuse network loads. Anyone can check it on the store
listing, or with `aapt dump permissions`.

`WebAssets.kt` answers every request the page makes and refuses any host but
its own, and `Engine.kt` sets `blockNetworkLoads` anyway, so that adding the
permission one day does not quietly open the reader to the network.

The same promise is why backup is off. `allowBackup="false"` plus
`data_extraction_rules.xml` keep the draft — somebody's typing, the beach, their
name — out of Google's cloud backup and out of device-to-device transfer.

## Ways in

**Choose a scanned PDF** — the system document picker. It reaches Google Drive
too, when the Drive app is installed, which covers most of what iOS's separate
*Choose from Drive* button does. The file is copied into the app's cache under
the name the volunteer knows it by (the name matters: the engine seeds the date
and beach from it, and a draft is only offered back to the file with the same
name and size). One scan is kept at a time; taking a new one deletes the last.

**The share sheet and "Open with".** On iOS this took a share extension, an App
Group and a drawer two processes could reach. On Android a share *is* an
intent delivered to the app: `ACTION_SEND` and `ACTION_VIEW` for
`application/pdf`, handled in `MainActivity`. It behaves as on iOS — the scan
starts a cleanup and waits on screen 3, because the event's date and beach come
first.

**Photographing the cards — built, and gated, exactly as on iOS.** ML Kit's
document scanner finds the page's corners and rectifies the perspective, which
answers the objection that removed image input once already. It runs in Google
Play services, so the app needs no camera permission. It runs in
`SCANNER_MODE_BASE`, because the other modes add an ML clean-up that erases what
it takes for smudges, and a faint pencil tally is exactly that. Captured pages
are bound into a PDF laid out at `pixels × 72/200` points so rasterizing at 200
DPI returns the camera's own pixels (`CapturedPages.pdf`). **What is unmeasured
is the same thing that is unmeasured on iOS: resolution, on a real card.** So
the button only exists in a build that asks for it:

```sh
./gradlew assembleDebug -Ptally.beta=true
```

## Google Drive is not in this build

iOS has *Choose from Drive* and *Save to Drive*, off unless the build is
configured with a Google project. The Android app leaves them out, and the
reason is the section above: they are the only features that would need the
INTERNET permission, and taking it would turn "the scan stays on this phone"
back from something the OS enforces into something the app promises.

What covers the gap: the document picker opens scans from Drive, and the
finished spreadsheet goes to Drive through the share sheet or *Save a copy*,
both of which hand the file to the Drive app rather than to this one. What does
not: opening straight onto the chapter's shared folder. If that turns out to
matter, it is a decision about the promise, and `docs/google-drive-ios.md` is
the design to follow — `drive.file`, the Picker page on Pages, no refresh token.

## Getting the spreadsheet out

**Send it on** is the system share sheet over the workbook (through a
`FileProvider` that exposes the export folder and nothing else). **Save a copy**
is new on Android: its share sheet has no built-in "save to this phone" target
the way iOS has Save to Files, so the system save dialog is offered beside it —
Downloads, a USB stick, or Drive again.

## Building it

Needs the Android SDK (Android Studio installs it) and a JDK 17 or later —
Android Studio's own is fine:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./android/sync-web.sh                      # rebuild dist/ and copy it into the app
cd android && ./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio after running `sync-web.sh` once.

`app/src/main/assets/web/` is generated and gitignored, like
`ios/SurfriderDataCards/web/`. **The build refuses to run without it** (the
`checkWebBundle` task), because an app without the bundle opens to a reader
that cannot read. Run `sync-web.sh` again after any change to `src/` — a stale
bundle looks exactly like a reading regression.

Onto an emulator or a phone with USB debugging on:

```sh
./gradlew installDebug
adb shell am start -n com.mateobesse.surfriderdatacards/.MainActivity
```

A debug build lets Chrome's inspector (`chrome://inspect`) into the engine's
page; a release build does not, because that page holds a scan.

## Getting it to volunteers

Google Play's equivalent of TestFlight is a **testing track** — internal (up to
100 testers, no review) or closed (a link, a short review). What it needs, none
of which exists yet:

1. **A Google Play developer account** ($25, once). The chapter's, ideally, not
   a person's.
2. **An application id you are happy to keep.** It is set in
   `gradle.properties` as `tally.applicationId`, and matches the iOS bundle
   identifier: `com.mateobesse.surfriderdatacards`. The same warning applies —
   it is personal, and changing it after release means a new listing and a
   fresh install for everybody.
3. **An upload key**, kept out of this repository (`*.jks` and `*.keystore` are
   gitignored). Play App Signing holds the real signing key.
4. **A version code that goes up every upload**:
   `./gradlew bundleRelease -Ptally.versionCode=$(date +%s)`, then upload
   `app/build/outputs/bundle/release/app-release.aab` in the Play Console.

The store listing's Data safety form is short and true: no data collected, no
data shared, and no network access to collect or share it with.

## What has and has not been done

As of 23 September 2026, on an Android 16 emulator (Pixel 8 image, WebView 133):

| | |
| --- | --- |
| Build | debug and minified release both build; Kotlin compiles with no warnings |
| No network | the merged manifest asks for no network permission, and `checkNoNetwork` fails the build when one is added back (tested by adding it back) |
| Engine | `engine.html`, the reference card, the cell maps and the digit model load in about 0.4s with no network access |
| **A card read end to end** | a real 10-page scan chosen in the system picker: 10 of 10 pages aligned, 5 cards, 228 cells, in about 11s. Values typed on the keypad, a true zero recorded, all eight screens walked, the spreadsheet made, and the typed 37 found in card 1's column C of the exported workbook |
| Share sheet out | *Send it on* opens the system sheet over the `.xlsx`, with Drive, Gmail and Quick Share offered |
| Camera (beta) | in a minified `-Ptally.beta=true` release build the ML Kit scanner opens, captures, and hands back pages that are bound into a PDF and read; a non-card picture is correctly refused on screen 5 |

**Not proven:**

- **Anything on a real phone.** Everything above is the emulator.
- **Sharing a scan INTO the app.** The `ACTION_SEND`/`ACTION_VIEW` path is
  built, but it could not be driven from `adb`: Android refuses to let the
  shell grant another app a MediaStore URI. Share a PDF from Files or Gmail on a
  real phone as the first thing you do.
- **The draft surviving backgrounding and being picked up again**, and the
  renderer-death recovery in `Engine.rendererGone`. Both are written and neither
  has been forced to happen.
- **Capture resolution on a real card**, exactly as on iOS. The emulator's
  camera is a painted room.
- **A scan the size of a big cleanup.** 10 pages is a small event; a 150-page
  scan is the memory test that decides whether the renderer-death handling is
  a safety net or the normal path.
- **Save a copy**, which opens the system save dialog; it was built but not
  driven.

**One thing that is not a bug:** a true zero ("Nothing there") is exported as
a blank cell. That is `src/lib/xlsx/export.ts` — "blanks mean zero and are
simply not written" — and the web tool and iOS app do the same.
