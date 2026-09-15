# The TestFlight pilot

How Tally gets from a build that installs on one phone to a build a chapter's
volunteers are using on their own, and what the pilot has to find out before that
is a reasonable thing to ask of them.

Two sibling documents. [`app-store-listing.md`](app-store-listing.md) is the
public release — everything App Store Connect asks for at submission.
[`../ios/README.md`](../ios/README.md) is how to build and sign. This one is the
middle: who tests, on what build, what they are being asked to answer, and what
result would mean this is ready to hand to a chapter.

**The pilot exists because of one line in the iOS handoff: reading a card inside
the app has never been exercised.** The pipeline is measured on 1,606 pages, and
all of that measurement is on the web side. On the phone it is assumed. A pilot
that answers nothing else has still earned its keep if it answers that.

---

## Where this actually got to

Written on 5 September 2026 as a plan for a pilot that could not start. It
started the same day. This section is what happened; the rest of the document is
the plan, corrected where it was wrong.

**Running now:**

| | |
| --- | --- |
| Membership | active, `Apple Distribution` on team `P45J6R7ZHD` |
| App record | *Data Cards*, Apple ID `6807599166`, `com.mateobesse.surfriderdatacards` |
| Internal group | **Chapter internal** |
| External group | **Chapter volunteers**, with a public link |
| Live build | `1788893453`, with the Drive picker |
| Testers | one invited by email, one anonymous through the public link, 3 sessions |

**What the setup list above cost, in order:**

1. ~~Apple Developer Program membership.~~ Done.
2. ~~A bundle identifier the chapter controls.~~ Settled by #49 as
   `com.mateobesse.surfriderdatacards` — three disagreeing identifiers were
   written down at the time, which is a thing to check before an App ID is
   registered, because the App Group and the share extension's bundle are both
   derived from it and a rename after testers are installed is a new app rather
   than an update. It is still personal rather than the chapter's.
3. ~~An app record.~~ Done.
4. **An App Store Connect API key.** Still not generated. Without it
   `testflight.sh` refuses to start, so every build so far went up through
   Xcode's Organizer instead.
5. **A feedback address.** Still a personal one. It is shown to every tester and
   outlives whoever is building this, so it should be a chapter address.

**Two things this document got wrong, corrected in place below.**

*External testing was not blocked by the Digital Services Act review.* That was
a guess, stated with more confidence than it deserved, when App Store Connect
showed no External Testing section at all. What actually brought the section
into existence was **creating the first internal group** — before that, both
entry points offered only "Create New Internal Group", regardless of build
state. Apple documents none of this; it is what was observed, twice.

*A public link is not something to decide about later.* App Store Connect
creates one with the external group, whether or not it is wanted. It hands
nothing out until a build is approved, and it can be turned off, but it exists
from the start.

---

## Two rounds, and they ask different questions

| | Round 1 | Round 2 |
| --- | --- | --- |
| Testers | 3–5, people building it and the chapter owner | one chapter's data-entry volunteers, 8–15 |
| Group | Internal (App Store Connect users, up to 100) | External (up to 10,000) |
| Review | None. Available when processing finishes | Beta App Review on the first build of a version, about a day |
| Build | `BETA=1 ./ios/testflight.sh` — camera included | `./ios/testflight.sh` — store-shaped, camera absent |
| Answers | Does it read a card on a phone at all? What DPI does a photograph land at? | Does a real cleanup get filed faster, and correctly? |
| Length | Until the answer is yes, or a week, whichever is longer | One cleanup each, minimum two cleanups total |

**Round 1 is a camera build on purpose.** `Beta.cameraCapture` gates
photographing the cards because nobody has measured what resolution a handheld
capture reaches on a real card in beach light, and the handoff calls that the
biggest open risk in the concept. That is not a question that can be reasoned
about; it is a question for people who can hold a phone over a card. It is also
exactly what a small internal round is for, because a build with an unmeasured
input in it should not go to a volunteer who will file the result.

**Round 2 is the build that would ship.** Camera absent, no beta flags, the same
archive that would go to App Review. A pilot on a build nobody would release
measures a thing nobody will use.

Do not put an external group on the camera build, and do not skip round 1 to save
a week. The gap between "it builds and launches" and "it read 58 cards on a
phone with 3GB of RAM" is where this will fail if it fails.

---

## What the pilot has to answer

Ordered by what would sink it. Each of these is a measurement, not an impression,
and the first three should be settled before anybody outside the room is invited.

**1. Does the same PDF produce the same spreadsheet on the phone as in the
browser?** This is the cheapest decisive test there is and it needs one tester.
Run a scan from `scans/` through the web tool, run the identical file through the
app, and compare the two exports cell for cell. The reading code is the same
TypeScript in both — `src/lib/` unchanged, in a WKWebView — so **any difference
at all is the bridge**, not the recognition, and it is a bug rather than a
tolerance. Same file, same values, or stop and find out why.

**2. Does a full-size scan survive a phone?** The 116-page test scan is 58 cards
and about 430MB of page images if they were all held at once, which is why they
are cut to row crops in the page and dropped. That arithmetic is right on a
laptop. Whether it holds on the oldest phone in the pilot is a question with one
answer per device. Record the device, the iOS version, the page count and the
wall-clock time, and whether the app was killed. **70 seconds for 58 cards is the
web figure**; the phone number will be worse and what matters is whether it is
minutes or tens of minutes.

**3. What DPI does a photographed card actually land at?** Camera build only.
The pipeline expects 200 DPI on the card's short edge. `VNDocumentCameraViewController`
rectifies perspective before handing the image over, so keystoning is handled;
resolution is not. Photograph a real card in the light a cleanup actually
happens in, export, and compare against the same card scanned. If the
photographed path reads materially worse, the gate stays on and the camera is not
part of round 2 — which is the current default and costs nothing.

**4. Does the share sheet path work on a real device?** It cannot be exercised on
an unsigned simulator build, because entitlements are not applied and the App
Group is not there. Share a PDF into the app from Files, from Mail, and from the
chapter's scanner app. The app should have the scan waiting on the capture screen
the next time it is opened. Note whether `datacards://inbox` brought the app
forward or whether the tester had to open it — either is acceptable, both are
worth knowing.

**5. Is the export where a volunteer can get at it?** The workbook goes to the iOS
share sheet. Confirm it reaches Files, Mail and Drive, opens in Numbers and in
Excel, and that the filename is one a chapter can file without renaming.

**6. How often is a hidden cell wrong? This is now the pilot's most important
question, not its most uncomfortable one.** A reading the tool is 45% or more
confident of is taken as the answer and its cell is never shown — 219 of 453
cells on the 58-card scan, and two thirds to three quarters of the cells on the
other two measured scans. Almost all are the digit reader working alone.

At 0.75, where this sat until 5 September 2026, the expected rate was about one
hidden value in six wrong, from a reader measured at 86% precision where it is
most confident. **At 0.45 most of what is hidden falls below every band that
reader has been measured in, so the expected rate is not known.** No amount of
reasoning will produce it; only counting will.

So one tester's job on one cleanup is to check every machine-read cell in the
export against the cards and count the disagreements. That single count is worth
more than everything else in this list, because until it exists nobody can say
what this build costs a chapter. `scripts/audit-prefills.mjs` renders the filled
cells to be counted, `scripts/autoaccept-coverage.mjs` measures any new
threshold, and `AUTO_ACCEPT` in `src/lib/prefill.ts` is the dial — 0.75 for the
August behaviour, above 1 to show every cell.

**7. Is it actually faster?** The claim is that an evening of transcription
becomes something shorter. Ask each tester for two numbers: how long the app took
end to end, and how long they would have expected to spend typing that stack. Two
honest estimates beat a stopwatch nobody remembered to start.

The best round 2 test is a cleanup the chapter has **already typed up by hand**.
`scans/` holds sixty of them, PDFs beside the spreadsheets somebody made from
them. Re-running one through the app gives a diff against a known answer, with no
extra work for anyone and no live event riding on it.

---

## Paste-ready: TestFlight Test Information

App Store Connect → your app → TestFlight → Test Information. Character limits
are Apple's; the counts beside each field are what the text below measures.

### Beta App Description — 4000 characters max, 1,888 used

Shown to every tester in the TestFlight app before they install.

```
Tally turns a stack of scanned beach cleanup data cards into the spreadsheet somebody would otherwise type by hand.

You give it a PDF of the cards. It finds each one, counts the tally marks, reads the handwritten numbers, shows you the boxes it is least sure of so you can settle them, and hands back a finished data-entry spreadsheet.

WHAT IS BEING TESTED

The reading has been measured against 1,606 pages of real cards, but all of that measurement was done in a browser on a laptop. This is the first time it has run on a phone in anybody's hands. What we most need to know is whether a full stack reads correctly and without the app being killed, and how long it takes on your device.

WHAT YOU NEED

A PDF of scanned data cards. The app cannot do anything without one — there is no demo mode. If you do not have a scan of your own, ask for one and we will send you a sample.

The app reads one specific card layout: the standard front-and-back tally card used for volunteer litter surveys. Another chapter's card will not work.

WHAT TO EXPECT

It is not always right. Handwritten numbers are the weak part — about 70% of digits are read correctly overall. This build fills in roughly half the boxes without showing them to you, including readings it is only moderately sure of, so wrong numbers will reach the spreadsheet without anyone seeing the handwriting first. We do not currently know how often. Finding out is the main thing we are asking of you: check the whole export against the cards before filing it anywhere real, and tell us how many were wrong.

NOTHING LEAVES YOUR PHONE

No account, no server, no network requests. Your scans, the readings and your corrections stay on the device until you export the spreadsheet and share it yourself. That is also true of this beta — we cannot see what you scanned, so anything you want us to know has to come through feedback.
```

### Feedback email

A chapter address, not a personal one. It appears in the TestFlight app beside
every build.

### Privacy Policy URL

The same URL the listing uses, and it has the same problem: it does not work
until GitHub Pages is switched on for the repository.

`https://surfrider-sd-bsa.github.io/surfrider-datacard-automation/privacy.html`

### Sign-in required

**No.** There is no account and no login. Leave the demo-account fields empty.

---

## Paste-ready: What to Test

Per build, 4000 characters max. This is the field that decides whether a tester
does the thing you need or opens the app once and forgets it. Be specific, ask
for few things, and say what to send back.

### Round 1 — internal, camera build (1,232 characters)

```
This build includes photographing cards with the camera, which the store build will not. Both inputs are on the capture screen.

Please do these four things, in this order:

1. FIRST, BEFORE ANYTHING ELSE: read a scanned PDF. Tap New cleanup, name it anything, then choose the PDF on the capture screen. Watch the progress bar. If it sits at zero and never moves, stop and tell us — that is the failure we are most expecting.

2. Note your device, your iOS version, the number of pages in the scan, and how long the read took. If the app was killed partway, that is the single most valuable thing you can report.

3. Photograph the same cards with the camera button, on a real card, outdoors if you can. Export both results. We want to know whether the photographed run reads as well as the scanned one — send us both spreadsheets.

4. Share a PDF into the app from Files and from Mail. It should be waiting on the capture screen next time you open the app.

Then export and open the spreadsheet somewhere real — Numbers, Excel, Drive — and tell us if anything about the file or its name is wrong.

Screenshot feedback is on. Please do not send a screenshot with a volunteer's name or handwriting in it; describe the screen instead.
```

### Round 2 — external, store-shaped build (1,205 characters)

```
This is the build we would release. Please use it the way you would actually use it, on a cleanup you would otherwise be typing up by hand.

What we are asking for:

1. Read a full stack, front and back in card order, on the phone you would normally use. Tell us the device, how many cards, and how long it took.

2. Do the review honestly. Anything the app is unsure of is shown to you with a picture of the box — settle those the way you would if the number mattered, because it does.

3. Export the spreadsheet and CHECK IT AGAINST THE CARDS before filing it. The app fills in some values without showing them to you when it is confident, and it is not always right. If you find a wrong number the app never asked you about, that is the most useful thing you can report — tell us the card and the row.

4. Tell us the two times: how long this took, and how long you would have expected to spend typing that stack.

If you have a cleanup you have already typed up, running that one is even better — you can compare the export against the spreadsheet you made and tell us exactly where they differ.

Please do not send screenshots containing volunteer names or handwriting. Describe what you saw instead.
```

---

## Paste-ready: Beta App Review notes

External testers only, and it is the same trap as the release submission: **a
reviewer who opens this app with no scan sees a tool that does nothing.**

```
This app reads scanned beach cleanup data cards and exports a spreadsheet. It needs a scan to do anything at all, so a sample PDF of real cards is provided.

To test it:

1. Save the sample PDF to the device (Files app).
2. Open the app. Tap "New cleanup" and give it any name and date.
3. On the capture screen, tap the button to choose a PDF, and pick the sample file.
4. The app reads the cards. This takes up to a minute for a large stack.
5. Review the results. Cells the app was not confident about are marked, and tapping one shows a picture of that box on the card.
6. Tap through to the end and export. The spreadsheet is handed to the iOS share sheet.

The app works entirely offline and makes no network requests. There is no account and no login.
```

The release App Review screen has an attachment control and the listing document
says to use it. **Check whether the beta review screen offers one before relying
on it** — if it does not, put the sample PDF somewhere a reviewer can download it
and give the URL in the notes above. A reviewer who cannot get a scan cannot get
past the first screen, and that is a rejection for the same reason it would be at
release.

---

## Groups

Two, named for what they are rather than for a round, because the rounds end and
the groups do not:

- **Chapter internal** — App Store Connect users. Builds arrive with no review.
  Up to 100 people, each on up to 30 devices. This is where every build goes
  first, including every round 2 build, a day earlier.
- **Chapter volunteers** — external. Named people, invited by email. Up to 10,000,
  which is not a constraint here.

**A public link comes whether or not you want one.** App Store Connect creates
it with the external group. The advice this document gave — don't use one, a
pilot's value is knowing who ran what on which phone — survived contact with
reality in the most direct way available: the link was live for a day, somebody
installed through it, and the tester list records them as *Anonymous* on an
iPhone 16 Pro with 3 sessions and no way to ask them a single question. That is
one of the two testers this pilot has.

Turn the link off under **Manage** if the pilot wants named people. Turning it
off stops new installs; it does not remove the app from anyone who already has
it.

TestFlight itself needs an iPhone on a current iOS; the app needs iOS 16 or later.
Say so in the invitation, because a volunteer with an older phone finds out at
the end of the install.

---

## Builds

Build numbers come from the clock — `testflight.sh` passes
`CURRENT_PROJECT_VERSION=$(date +%s)` — because App Store Connect refuses a
`CFBundleVersion` it has already seen rather than replacing it. Nothing to
remember and nothing to keep in a file.

The marketing version stays `1.0` through the pilot. Bump it when what testers
are running stops being what 1.0 means, not on every upload.

**A TestFlight build expires 90 days after upload.** A pilot that runs longer
than that needs a fresh build for no other reason, so plan on uploading at least
monthly even if nothing changed.

Cadence: upload when there is something for a tester to do differently. A build a
week during round 1 while the answers are still coming in; a build only when
something they reported is fixed after that. Every build carries a "What to Test"
that says what changed since the last one — testers who cannot tell the builds
apart stop reading them.

**Run `./ios/sync-web.sh` before every build.** `testflight.sh` does it for you.
An app built against a stale web bundle looks exactly like a reading regression
and is not one, and that is a day nobody gets back.

**Uploading through Organizer: choose App Store Connect, not TestFlight Internal
Only.** Xcode remembers the last method used and preselects it. A build sent as
Internal Only is stamped `Internal`, and it can never be given to an external
tester — it archives, uploads and processes exactly like any other build, and
then simply is not offered when you go to add it to the external group. Build
`1788708247` was lost that way.

**Check that a setting which is silent when missing actually made it in.** The
Drive picker is compiled from `GOOGLE_CLIENT_ID` and `GOOGLE_API_KEY`; without
them the app has no Drive button and reports nothing. Four builds reached
TestFlight without it, one of them approved and installed, before anybody noticed.
`ios/google-settings.sh` now supplies them to every build, and the check that
proves it is reading the value back out of the compiled app rather than trusting
the build command:

```sh
/usr/libexec/PlistBuddy -c "Print :GoogleClientID" \
  ios/build/DataCards.xcarchive/Products/Applications/"Data Cards.app"/Info.plist
```

---

## Inviting people

Long enough to be honest, short enough to be read. Email:

```
Subject: Try the data card app before we hand it to the chapter

We built a phone app that reads our beach cleanup data cards and gives back the
data-entry spreadsheet, so nobody has to type a stack of tally marks into a
laptop again. It works. We would like to know whether it works for you before we
tell anyone to rely on it.

What it involves: install it through TestFlight (Apple's beta app — we send a
link, you tap install), then use it on one cleanup's cards instead of typing them
up. Half an hour, most of which is you checking numbers the app was not sure
about. You will need an iPhone on iOS 16 or later and a PDF scan of the cards.

What we need back: whether the spreadsheet was right, how long it took, and
anything that went wrong. There is a note in the app about what to look for.

Two honest things. The app reads handwritten numbers correctly about 70% of the
time, so check the export against the cards before filing it — it is a first
guess to correct, not an answer. And where it is confident it fills a number in
without showing it to you, which is where a mistake could get past all of us.
Finding one of those is the most useful thing you could do for us.

Nothing leaves your phone. There is no account, no server, and the app makes no
network requests at all. We cannot see your scans, so anything you want us to
know has to come back through TestFlight feedback or this address.

Reply with the email address you use for your Apple ID and we will send the
invitation.
```

For a group chat:

```
We have a phone app that reads our cleanup data cards and spits out the data
entry spreadsheet. Looking for a few people to try it on one cleanup's cards
before we hand it round. iPhone on iOS 16+, about half an hour, and you check the
numbers at the end. Send me your Apple ID email if you are up for it.
```

---

## What comes back, and where it goes

**TestFlight's own channels.** Testers can send a screenshot with a note from the
TestFlight app; crashes come back with a log if the tester agreed to share
diagnostics at install. Both land in App Store Connect under TestFlight →
Feedback. Neither is guaranteed, and a tester who screenshots the review screen
has just photographed somebody's handwriting — say so in the What to Test, as the
text above does.

**The one thing worth a form.** Six questions, one message, and it should take a
tester two minutes:

1. Device and iOS version.
2. How many cards, and how long did the read take?
3. Did the app get killed, refuse a page, or hang?
4. How many cells did it ask you about, roughly?
5. After you exported: how many numbers were wrong, and were any of them ones it
   never showed you?
6. How long would you have spent typing that stack?

Question 5 is the one that matters. Everything else has an instrument in
`scripts/`; that one only a person holding the cards can answer.

**Where the answers live.** A section in `HANDOFF.md`, with the device beside
every number, in the same form as every other measurement in this project.
Pilot results that live in an inbox are not results.

---

## Go / no-go

The pilot is over and the app goes to the chapter when all of these are true:

- The app's export matches the web tool's export, cell for cell, on at least
  three different scans.
- A full-size stack (50+ cards) has been read on at least three different phones,
  including the oldest one anybody uses, without the app being killed.
- Two cleanups have been filed from the app by someone other than the person who
  built it, and the spreadsheets were checked against the cards.
- The rate of wrong hidden values has been **counted on real cards at 0.45**, and
  somebody has looked at that number and decided it is acceptable to file. There
  is no expected figure to compare it against any more, which is exactly why the
  count is a release blocker rather than a nice-to-have. If it is bad, raise
  `AUTO_ACCEPT` and run the last round again — a number that reaches a chapter's
  data unseen is the one failure mode this whole design is arranged against.
- The share-sheet path, the export, and the filename have each been exercised by
  somebody who was not told how.

The camera is **not** on this list. It is a round 1 question with its own answer,
and shipping without it costs nothing; the gate exists precisely so that this
decision can be made on the measurement instead of the calendar.

Not ready, and worth saying out loud: if reading inside the app turns out to be
slower than a volunteer will tolerate, the answer is not a faster pilot. The web
tool works today, on a laptop, on the same scans. The phone is a convenience and
it has to earn its place.
