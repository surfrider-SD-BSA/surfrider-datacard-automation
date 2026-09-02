# App Store listing copy

Everything App Store Connect asks for, written out and ready to paste. Character
limits are Apple's; the counts beside each field are what the text below actually
measures, checked rather than estimated.

The privacy policy that goes with this lives in [`privacy.html`](privacy.html).

---

## App name — 30 characters max

**Tally: Beach Cleanup Cards**

Backups, in order, for when the first is taken:

1. `Beach Cleanup Data Cards`
2. `Tally Cleanup Data Cards`
3. `Cleanup Cards: Tally & Export`

"Surfrider" is deliberately absent from all four. The developer account is
personal, so a trademark in the title invites App Review to ask for written
authorization from the trademark holder, and that is a multi-week detour for no
gain. The home-screen name stays `Data Cards` either way — `CFBundleDisplayName`
and the App Store name are separate fields.

## Subtitle — 30 characters max

**Paper cards to a spreadsheet**

## Promotional text — 170 characters max

> Scan your beach cleanup data cards and get a finished spreadsheet back, without
> typing a single number twice. Everything happens on your phone, offline.

Promotional text can be changed without submitting a new build, so this is the
field to edit when something needs saying between releases.

## Keywords — 100 characters max, comma-separated, no spaces

```
cleanup,beach,litter,tally,volunteer,survey,datacard,spreadsheet,scan,ocean,marine,debris
```

Do not repeat words already in the name or subtitle — Apple indexes those anyway,
and a repeat wastes the budget.

## Description — 4000 characters max

Beach cleanup data cards are paper. Somebody has to turn them into a spreadsheet,
and that somebody usually spends an evening squinting at tally marks and typing
numbers into a laptop.

Data Cards does the reading.

Scan your stack on any scanner, or share the PDF into the app from Files, Mail, or
your scanner's own app. It finds each card, counts the tally marks, reads the
handwritten numbers, and lays the results out for you to check. Anything it isn't
sure about, it says so and shows you a picture of that box, so you can settle it
in a tap. When the columns add up, it hands you a finished spreadsheet.

WHAT IT DOES

• Reads a whole stack in one pass, front and back, in card order
• Counts tally marks, including the struck-through fives
• Reads handwritten digits
• Flags what it cannot read instead of guessing, and shows you the box in question
• Exports a data-entry spreadsheet ready to file
• Works entirely offline, at the beach, with no signal

BUILT FOR ONE CARD

This app reads one specific layout: the standard front-and-back tally card used
for volunteer litter surveys. It is not a general-purpose form scanner or
handwriting reader, and it will not read arbitrary documents. If your chapter uses
a different card, it will not work for you yet.

NOTHING LEAVES YOUR PHONE

There is no account, no server, and no network connection. The scans, the
readings, and your corrections stay in the app until you export the spreadsheet
and share it yourself. Nothing is uploaded, tracked, or analyzed. The app makes no
network requests at all.

HOW THE READING IS CHECKED

The recognition has been measured against 1,606 pages of real cards, from 28 scans
across 10 beaches. When the app declines to read something rather than guessing,
that is the design: a wrong number filed quietly is worse than a number a
volunteer is asked to confirm.

Made for the people who do the counting.

## What's New

Leave empty. A first release has no "what's new" — the field only applies from
version 1.1 onward.

---

## URLs App Store Connect requires

| Field | Value |
| --- | --- |
| Support URL | `https://github.com/surfrider-SD-BSA/surfrider-datacard-automation` |
| Privacy Policy URL | `https://surfrider-sd-bsa.github.io/surfrider-datacard-automation/privacy.html` |
| Marketing URL | Optional. Leave blank. |

**The privacy policy URL does not work yet.** It needs GitHub Pages switched on
for the repository — Settings → Pages → Source: *Deploy from a branch*, branch
`main`, folder `/docs`. Load the URL in a browser and confirm it renders before
pasting it into App Store Connect; a policy URL that 404s is a rejection.

## Category and rating

- **Primary category:** Utilities
- **Secondary category:** Productivity
- **Age rating:** answer every question "None". The result is 4+.

## Privacy nutrition label

Answer **Data Not Collected**. This is true and verifiable: no network APIs in the
Swift code, no remote fetches or analytics in the web source, and every asset the
app needs ships inside the bundle.

## Export compliance

Already answered in the app's `Info.plist` as
`ITSAppUsesNonExemptEncryption = false`, so App Store Connect will not ask again
at upload time.

---

## App Review notes

Paste this into the *Notes* field, and attach one PDF from `scans/` using the
attachment control on the same screen.

> This app reads scanned beach cleanup data cards and exports a spreadsheet. It
> needs a scan to do anything, so I have attached a sample PDF of real cards.
>
> To test it:
>
> 1. Save the attached PDF to the device (Files app).
> 2. Open the app. Tap "New cleanup" and give it any name and date.
> 3. On the capture screen, tap the button to choose a PDF, and pick the attached
>    file.
> 4. The app reads the cards. This takes up to a minute for a large stack.
> 5. Review the results. Cells the app was not confident about are marked, and
>    tapping one shows the picture of that box on the card.
> 6. Tap through to the end and export. The spreadsheet is handed to the iOS share
>    sheet.
>
> The app works entirely offline and makes no network requests. There is no
> account or login.
>
> Note on the camera permission: the app declares NSCameraUsageDescription for a
> photograph-the-cards feature that is disabled in this release. This version
> never presents the camera and will not request camera access.

**Why this matters more than the rest of the listing.** A reviewer who opens this
app with no scan available sees a tool that appears to do nothing, and that is a
guideline 2.1 rejection. The attachment is the single highest-value thing in the
whole submission.
