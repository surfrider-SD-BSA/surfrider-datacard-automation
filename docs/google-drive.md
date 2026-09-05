# Opening scans from the chapter's shared Drive folder

The scans land in a shared Google Drive folder after a cleanup. Without this
set up, the person doing the data entry downloads one to their laptop and drags
it into the page. With it set up, they press **Choose from Google Drive**, pick
the scan out of the shared folder, and the tool reads it.

It is **off unless configured**, and a build with no configuration fetches
nothing from Google at all — no button, no scripts, no third party. If your
chapter is happy dragging files in, you can stop reading; nothing below is
required to use the tool.

## What this changes about the privacy promise

Worth being exact, because the rest of the tool is built on not having a third
party in it and this is the one place there is one.

**What stays true.** The scan is not uploaded. It is *downloaded*, from a folder
that already holds it, into the browser tab, and read there like any other file.
There is still no server of ours, still no copy anywhere, and the volunteers'
handwriting still goes nowhere.

**What changes.** Somebody signs into Google, and Google learns that this account
opened this file — which it would have learned from the same person downloading
it by hand. The app asks for the `drive.file` scope, which grants it access to
the individual files the person picks and to **nothing else in their Drive**: it
cannot list the folder, cannot open a file nobody chose, and the access ends
when the tab closes. There is a **Sign out of Google** button on the review
screen for shared laptops.

`drive.readonly` would have been simpler and is not used, deliberately. It would
mean asking a volunteer to grant a beach-cleanup transcription tool the ability
to read their entire Drive.

## Setting it up

About fifteen minutes, once, by someone with a Google account that can create a
Cloud project. The chapter owner does not have to be the one who does it.

### 1. A Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a project — name it
   something like `surfrider-datacards`.
2. Note the **project number** (Cloud console → the project picker, or the
   dashboard). It is a long number, not the project *ID*. You need it only if
   the scans live on a shared drive, but write it down now.

### 2. Turn on the two APIs

Under **APIs & Services → Library**, enable:

- **Google Drive API** — downloading the file the person picked
- **Google Picker API** — the folder-browsing window itself

### 3. The consent screen

**APIs & Services → OAuth consent screen**:

- User type **External**, unless your chapter is on Google Workspace, in which
  case **Internal** is simpler and skips the verification question entirely.
- App name, support email, developer email. The app name is what volunteers see
  on the "… wants access to your Google Account" screen, so make it something
  they will recognise — "Surfrider Data Cards" rather than the project ID.
- Add the scope `https://www.googleapis.com/auth/drive.file`. It is on Google's
  list of scopes that do **not** require their app-verification review, which is
  the other reason it is the scope this uses.
- While the app is in **Testing**, add each volunteer who will use it under
  **Test users**. This is the step people forget: someone not on that list gets
  an "app is blocked" screen with no useful explanation. A chapter with a stable
  handful of data-entry volunteers can stay in Testing indefinitely — note that
  Google expires the grant after 7 days in that mode, so they will re-consent
  about weekly. Publishing the app removes both the list and the expiry.

### 4. Credentials

**APIs & Services → Credentials**:

- **Create credentials → OAuth client ID → Web application.** Under
  **Authorised JavaScript origins**, add every origin the page is served from.
  This must match exactly — scheme, host and port:
  - `http://localhost:5173` for `npm run dev`
  - `https://<chapter>.github.io` if it is published to GitHub Pages
  Copy the **client ID**.
- **Create credentials → API key.** Then **restrict it** — an unrestricted key
  is the one genuinely careless thing available on this page. Set *Application
  restrictions* to **Websites** and list the same origins; set *API
  restrictions* to the **Google Picker API**. Copy the key.

### 5. The folder

Open the shared folder in Drive and copy the URL out of the address bar. It
looks like `https://drive.google.com/drive/folders/1a2B3c...`. Paste the whole
thing — the config understands either the URL or the bare ID.

Make sure the folder is shared with the volunteers who will be picking from it.
Viewer access is enough. **This is the actual boundary**: the picker lets people
navigate out of the folder it opens on, so what a volunteer can reach is what
Drive has shared with them, not what this setting says. The folder ID only saves
them the navigation.

### 6. Write it down

```bash
cp .env.example .env.local
```

Fill in `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and
`VITE_GOOGLE_DRIVE_FOLDER_ID`. Add `VITE_GOOGLE_APP_ID` (the project number) and
`VITE_GOOGLE_SHARED_DRIVES=true` if the scans are on a shared drive rather than
in someone's My Drive.

`.env.local` is gitignored. For a GitHub Pages build, set the same variables as
repository secrets and pass them to the build step.

None of these are secrets — Vite compiles them into the bundle and anyone can
read them off the published page. That is how browser OAuth works and is why
the API key restrictions in step 4 are the thing that matters. **Nothing that
would be a real secret may go in this file**: this repository publishes its
build to the open web.

## Checking that it works

The Google half of this cannot be covered by the test suite — it is three
network round trips through a library that only exists in a real browser tab,
and a test with all of it mocked would only prove the mock agrees with the code.
So it is checked by using it. `tests/drive.test.ts` covers the part that is
honestly testable, which is the folder-ID parsing.

Run `npm run dev`, open the printed URL, and:

1. The **Choose from Google Drive** button is there. (If it is not, the client
   ID or API key is missing — the button is drawn only when both are set.)
2. Pressing it opens Google's consent screen, and the screen names the scope as
   seeing and downloading only files you open with this app. If it asks for
   anything broader, stop: the scope is wrong.
3. Consenting opens the picker **on the shared folder**, showing the scans. If
   it opens on "Recent" instead, the folder ID did not parse — check it against
   the URL you copied.
4. Picking a scan shows `Downloading… n%` and then goes into the normal reading
   flow. From that point on nothing about the file is different: same progress
   bar, same review list, same spreadsheet.
5. The footer says the scan was downloaded from Drive and read here.
6. **Sign out of Google** on the review screen leaves the typed values alone.

Known failures and what they mean:

| What you see | What it is |
| --- | --- |
| "app is blocked" / "has not completed verification" | The Google account is not in **Test users** (step 3). |
| The consent window opens and immediately closes | The page's origin is not in **Authorised JavaScript origins** (step 4), including its port. |
| Picker opens empty, or on "Recent" | Folder ID wrong, or the folder is not shared with this account. |
| "The browser blocked Google's sign-in window" | A popup blocker. Allow popups for the page. |
| "Drive would not hand over that file" | The file is not shared with the signed-in account. On a shared drive, check `VITE_GOOGLE_APP_ID` and `VITE_GOOGLE_SHARED_DRIVES`. |
