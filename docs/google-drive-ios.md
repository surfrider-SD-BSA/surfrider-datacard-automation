# Opening scans from Drive, in the iOS app

The app's counterpart to [google-drive.md](google-drive.md). Same folder, same
`drive.file` scope, same bargain — a volunteer presses **Choose from Drive** on
the capture screen, signs into Google, picks the scan out of the chapter's
folder, and the reading starts. It is **off unless configured**, and a build made
without a Google project has no button and **makes no network call of any kind**.

Read the web document first. Everything it says about what the feature costs and
what stays true is the same here, and is not repeated.

## What is different on a phone

Three things, and they are the reason this is a separate document.

**The sign-in is native.** `ASWebAuthenticationSession` with PKCE, against an
**iOS** OAuth client, which has no client secret — a secret shipped inside an app
is not a secret. No refresh token is requested, so the grant expires in about an
hour and cannot be renewed quietly. The token is held in memory for as long as
the app is running and is written to no file and no Keychain; quitting the app
ends it. See `ios/SurfriderDataCards/Drive/DriveAuth.swift`.

Google refuses OAuth inside an embedded web view, so this is not a choice — but
it is also the better outcome: the volunteer gets an address bar and can see
they are typing their password into `accounts.google.com`.

**The picker is not.** `drive.file` grants access to the files a person picks
*in Google's Picker*, and the Picker is a JavaScript library with no native iOS
counterpart. It will only run on an origin registered with Google, and a web
view's own origin cannot be registered. So the app loads
[`ios-picker.html`](ios-picker.html) — served from this repository's GitHub Pages
site — into a web view, hands it a token through the URL **fragment** (which is
never sent to a server, so it appears in no access log), and gets back a file id.
Nothing else crosses: the page does not download anything and never sees a card.

The alternative was asking volunteers for `drive.readonly` and the run of their
entire Drive, so that the app could list a folder itself. That is the trade
`src/lib/drive.ts` refuses, and refusing it is why this page exists.

**The download is native.** Streamed by `URLSession` straight to a file in the
app's temporary directory, with a progress bar, then handed to the same
`read(pdf:)` a file from the document picker goes through. Downstream, a scan
from Drive is indistinguishable from one that was AirDropped — one reading path,
and it is the one measured on 1,606 pages.

## Setting it up

You need the Google Cloud project from [google-drive.md](google-drive.md) first —
steps 1 to 3 there (project, APIs, consent screen) are shared. Then:

### 1. An iOS OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID → iOS.**

- **Bundle ID** must match the app's exactly. For this chapter's build that is
  `com.mateobesse.surfriderdatacards`; check `APP_BUNDLE_ID` in the Xcode project
  if you are not sure.
- Copy the **client ID**. There is no secret to copy — that is expected.

Do not reuse the Web client ID from the browser tool. A Web client rejects the
redirect an iOS app uses, with an error that names neither.

### 2. An API key for the picker

**Create credentials → API key**, then **restrict it**:

- *Application restrictions* → **Websites**, and add the origin the picker page
  is served from — `https://surfrider-sd-bsa.github.io` for this repository.
  Not the app's bundle ID: the request comes from a web page, not from the app.
- *API restrictions* → **Google Picker API**.

An unrestricted key is the one genuinely careless thing available on this page.

### 3. Publish the picker page

`docs/ios-picker.html` is served by GitHub Pages from `main`, so it is published
by merging it — nothing else to do for this repository. Confirm it is up:

```sh
curl -sI https://surfrider-sd-bsa.github.io/surfrider-datacard-automation/ios-picker.html | head -1
```

**A fork must host its own copy** and set `GOOGLE_PICKER_URL` to it. The origin is
half of what the API key restriction checks, so a fork pointing at this one gets
a picker that will not load.

### 4. Build with it

Nothing about a chapter's project is committed. The settings are passed in:

```sh
export GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
export GOOGLE_API_KEY=AIza...
export GOOGLE_DRIVE_FOLDER_ID='https://drive.google.com/drive/folders/1a2B3c...'
# Only if the scans are on a shared drive rather than in someone's My Drive:
# export GOOGLE_SHARED_DRIVES=true
#
# GOOGLE_APP_ID is NOT in this list on purpose. The picker has to name the app
# when it hands a file over -- that naming is what makes `drive.file` cover the
# file somebody picked -- and the id it names is the Cloud project number, which
# is already the first part of GOOGLE_CLIENT_ID. The app reads it from there.
# Set GOOGLE_APP_ID only for a project whose client ID does not start with its
# project number.

TEAM_ID=... ASC_KEY_ID=... ASC_ISSUER_ID=... ./ios/testflight.sh
```

For a local build, pass the same names to `xcodebuild` as build settings.
`GOOGLE_DRIVE_FOLDER_ID` takes the folder URL or the bare ID, like the web one.

Setting `GOOGLE_CLIENT_ID` without `GOOGLE_API_KEY` is refused by the script
rather than producing a button that fails inside the picker.

## Checking that it works

The Google half cannot be covered by tests — it is a consent screen, a token
exchange and a JavaScript library that only exists in a real web view, and a test
with all of it mocked would only prove the mock agrees with the code. So it is
checked by using it, on a phone:

1. On the capture screen, **Choose from Drive** is under *Choose a scanned PDF*.
   (If it is missing, the client ID or the API key was not in the build — they
   are both required and the button is drawn only when `DriveConfig.current` is
   non-nil.)
2. Pressing it opens Google's consent screen, and it names the scope as seeing
   and downloading only files you open with this app. **If it asks for anything
   broader, stop** — the scope is wrong.
3. Consenting opens the picker on the shared folder, showing only PDFs.
4. Picking one shows `Downloading … n%`, then the ordinary reading screen.
5. A second scan in the same session skips the consent screen, because the token
   is still good. Quitting the app and coming back asks again.

Known failures and what they mean:

| What you see | What it is |
| --- | --- |
| No button at all | No client ID or no API key in the build (step 4). |
| "app is blocked" / "has not completed verification" | The Google account is not in **Test users** — see google-drive.md step 3. |
| Google says the redirect does not match | A **Web** client ID was used instead of an **iOS** one (step 1). |
| The picker sheet is blank, or "picker page could not be loaded" | The page is not published, or `GOOGLE_PICKER_URL` points somewhere that is not (step 3). |
| The picker loads but shows an error about a developer key | The API key is missing, or its **Websites** restriction does not list the page's origin (step 2). |
| Picker opens somewhere other than the shared folder | The folder ID did not parse, or the folder is not shared with this account. |
| "Drive would not hand over that file" | Usually **not** what it says. Drive answers 403 for a picked file when the picker did not name the app, so `drive.file` never covered it -- check that the app id reached the picker (it is derived from the client ID; see `DriveConfig.projectNumber`). Genuine sharing problems look the same, so rule the app id out first. On a shared drive also check `GOOGLE_SHARED_DRIVES`. |
