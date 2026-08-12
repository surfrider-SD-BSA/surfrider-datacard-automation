# Surfrider Beach Cleanup Data Card Automation

Extract handwritten debris counts from scanned beach cleanup data cards and generate pre-filled
Excel spreadsheets matching the standard Surfrider data entry template.

Built for [Surfrider Foundation](https://www.surfrider.org/) volunteer chapters. Developed and
tested by the San Diego Chapter (CH54).

## Status

**Working, and in trial use.** Drop a scanned PDF in the browser, check the numbers against a
picture of each one, download the chapter's spreadsheet. Verified end to end on a real 116-page
scan: 58 cards in about 70 seconds, no page refused.

What is proven, and what is not, is set out in [HANDOFF.md](HANDOFF.md) with the measurements
behind it. The short version: locating the writing works and generalizes; **reading** the
handwriting does not work well enough to ship and is deliberately switched off.

## The problem

Volunteers record debris counts on paper data cards during a cleanup. Someone then types every
value into a spreadsheet by hand. For a large event that is several hours of transcription, and
transcription errors are hard to catch after the fact.

## The approach

The tool does not try to read the handwriting. Deciding **whether** a box has writing in it is
easy and reliable; reading **what it says** is neither, and a confidently wrong number is worse
than no number at all — it invites agreement.

So it answers only the easy question, and shows a person a cropped picture of each cell to type
from:

1. A scanned PDF is rasterized in the browser at 200 DPI.
2. Each page is aligned against a reference card, and the alignment is verified against the
   card's own printed section banners. A page that will not line up is refused and surfaced,
   never cropped from — a misregistered page yields ordinary-looking numbers attached to the
   wrong debris items, which nothing downstream could catch.
3. Every cell is tested for handwriting by shape rather than by how much ink is in it, because
   the card's printed ruling carries more ink than faint pencil does.
4. The reviewer sees a picture of each cell beside a box, and types what they see.
5. The chapter's Excel template is filled in and downloaded.

On a 58-card event this is 453 cells to check, down from 730 before the shape test, against
roughly 4,800 on the cards. Nothing is guessed, so nothing can be confidently wrong.

### It runs in the browser, and nothing leaves the laptop

There is no server, no account, no API key and no billing relationship. The PDF is read by the
page itself and never uploaded. That is a deliberate constraint: the scans carry volunteer
handwriting, and the simplest way to keep them private is for them never to go anywhere.

## Running it

```bash
npm install
npm run dev      # then open the printed URL and drop in a scanned PDF
```

`npm test` runs the suite; `npm run build` produces a static bundle in `dist/` that can be opened
from a file share or hosted anywhere, since there is no back end.

### Requirements

- Node 20 or later, to build and to run the dev server
- A modern browser to use it
- Python 3.9 or later, only for the two offline helper scripts under `scripts/`
  ([openpyxl](https://openpyxl.readthedocs.io/) is used there for spreadsheet checks)

## Handling volunteer data

Scanned data cards and generated spreadsheets can contain volunteer names and other personal
information. **Never commit files from `input/`, `output/`, `scans/` or `out/`.** `.gitignore`
blocks all four, a pre-commit hook backstops it (see [CONTRIBUTING.md](CONTRIBUTING.md)), and CI
fails if any of them ever appear as tracked files.

There is a third protection worth knowing about, because gitignore does not help with it:
`vite.config.ts` sets `publicDir: "assets"`, so **anything placed under `assets/` is copied into
a build verbatim**, ignored or not. Scans live outside that tree for exactly this reason, and
`scripts/check-dist.mjs` fails the build if data-shaped files turn up in `dist/`.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and chapter-specific template questions
are welcome via [issues](https://github.com/surfrider-SD-BSA/surfrider-datacard-automation/issues).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security or
privacy issue, see [SECURITY.md](SECURITY.md).

## License

[GNU General Public License v3.0](LICENSE).
