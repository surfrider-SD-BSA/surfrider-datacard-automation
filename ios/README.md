# The iOS app

A native shell around the web tool. It is deliberately thin.

## Why it is thin

The reading is not reimplemented in Swift and should not be. Registration,
tally counting and digit recognition are measured in `HANDOFF.md` against the
TypeScript in `src/`, and a Swift port would be a second implementation to keep
in step with a set of figures that took months to establish. This app loads the
same built bundle out of its own package and runs it offline.

That means a fix to the reading is a change to `src/`, not to anything here.

## What the shell actually adds

Three things a web page cannot do by itself on iOS.

**Its own origin.** The page fetches the reference card, the cell maps and the
3.4MB digit model with `fetch()`. WKWebView refuses cross-origin fetches from
`file://`, so all of them fail and the app opens to a tool that cannot read
anything. `WebAssetSchemeHandler` serves the bundle under a `cleanup://` scheme,
which is treated as a proper origin, and the page runs unchanged.

Watch the MIME types there. `pdf.worker.min.mjs` served as anything but a
JavaScript type is rejected by the module loader, and the app then hangs on
"Reading the PDF…" with nothing in the console, because the failure is inside a
worker nobody is watching.

**Getting the spreadsheet out.** The page builds a blob and clicks an
`<a download>`. In WKWebView that is a navigation to a `blob:` URL, which is
cancelled silently — the button appears to do nothing. `WebScreen` intercepts
the download, writes it to a temp file and offers the share sheet, which is how
a file leaves an app on iOS anyway: Files, AirDrop, Mail.

**The camera.** `<input type="file" accept="image/*" capture="environment">`
raises the native picker on its own. What it needs is `NSCameraUsageDescription`
and `NSPhotoLibraryUsageDescription` in `Info.plist`; without them iOS kills the
app rather than refusing the picker.

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

## What has NOT been done

- **It builds, installs, launches and renders** on an iPhone 17 simulator
  (iOS 26.5): the bundle is served through `cleanup://` and the front screen
  comes up. `digit-model.json` and `pdf.worker.min.mjs` are both confirmed
  present in the built `.app`.
- **Reading a card INSIDE the app has not been exercised.** Doing that means
  driving the file picker, and the simulator-control integration needs
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, which is
  a password the build cannot supply. So the PDF and photo paths are proven on
  the web side and assumed here. **Load a card as the first thing you do**, and
  if it hangs on "Reading the PDF…" with nothing in the console, the MIME type
  note above is where to look.
- **No signing, no App Store.** There is no team, no provisioning profile and
  no bundle identifier the chapter owns — `org.surfrider.sd.datacards` is a
  placeholder. Putting it on a real iPhone needs an Apple Developer account.
- **No app icon or launch screen.**
- **Photographs are not scans.** The web tool now accepts an image as well as a
  PDF, and registration corrects rotation and scale but not the keystoning you
  get holding a camera at an angle. Nothing has been measured on real phone
  photographs. That is the first thing worth testing, and the thing most likely
  to need work.
