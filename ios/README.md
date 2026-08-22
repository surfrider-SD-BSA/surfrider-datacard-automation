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

Two things a web page cannot do by itself on iOS.

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

There used to be a third: the camera. An earlier version accepted a photograph
through `<input type="file" accept="image/*" capture="environment">`, which
raises the native picker on its own but needs `NSCameraUsageDescription` and
`NSPhotoLibraryUsageDescription` in `Info.plist` -- without them iOS kills the
app rather than refusing the picker. The input is now `accept="application/pdf"`
and nothing else, so both keys are deliberately absent. Read the comment where
they would go in `Info.plist` before putting image input back.

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

- **It builds, installs, launches and renders** on an iPhone 17 simulator
  (iOS 26.5) and on a physical iPhone: the bundle is served through `cleanup://`
  and the front screen comes up. `digit-model.json` and `pdf.worker.min.mjs` are
  both confirmed present in the built `.app`.
- **Reading a card INSIDE the app has not been exercised.** Doing that means
  driving the file picker, which nothing here automates. So the PDF path is
  proven on the web side and assumed here. **Load a card as the first thing you
  do**, and if it hangs on "Reading the PDF…" with nothing in the console, the
  MIME type note above is where to look.
- **Development signing only.** A free personal team signs
  `com.mateobesse.datacards`, and Xcode issues a provisioning profile that
  expires seven days after it is created, so the app stops launching a week after
  each install. There is no paid membership, no distribution certificate and no
  identifier the chapter owns, so TestFlight is still out of reach.
- **No custom launch screen.** `UILaunchScreen` is an empty dict, which takes the
  system default. There is an app icon, generated by `ios/make-icon.mjs`.
- **Nothing measured on phone photographs.** This is a decision rather than a
  gap: the input is `accept="application/pdf"` and image input was removed. A
  photograph held at an angle keystones, and registration corrects rotation and
  scale but not that. Restoring image input means restoring the two
  usage-description keys with it.
