# Surfrider Beach Cleanup Data Card Automation

Extract handwritten debris counts from scanned beach cleanup data cards and generate pre-filled
Excel spreadsheets matching the standard Surfrider data entry template.

Built for [Surfrider Foundation](https://www.surfrider.org/) volunteer chapters. Developed and
tested by the San Diego Chapter (CH54).

## Status

**Pre-release.** This repository currently holds project governance and contribution setup. The
implementation has not been published here yet. Watch the repo or see
[open issues](https://github.com/surfrider-SD-BSA/surfrider-datacard-automation/issues) for progress.

## The problem

Volunteers record debris counts on paper data cards during a cleanup. Someone then types every
value into a spreadsheet by hand. For a large event that is several hours of transcription, and
transcription errors are hard to catch after the fact.

## The approach

1. Scanned data card PDFs go into an `input/` folder.
2. An extraction step reads the handwritten counts from each volunteer card and writes structured
   JSON, tagging each value with a confidence level.
3. A Python script copies the chapter's Excel template and fills in the extracted values.
4. A review report lists every low-confidence value with its source page, so a human can verify
   the handwriting without re-reading the whole stack.

The human review step is not optional. The tool reduces transcription work; it does not replace
verification.

## Requirements

- Python 3.9 or later
- [openpyxl](https://openpyxl.readthedocs.io/) for Excel generation
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) for the extraction step

## Handling volunteer data

Scanned data cards and generated spreadsheets can contain volunteer names and other personal
information. **Never commit files from `input/` or `output/`.** `.gitignore` blocks both, and a
pre-commit hook backstops it — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and chapter-specific template questions
are welcome via [issues](https://github.com/surfrider-SD-BSA/surfrider-datacard-automation/issues).

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security or
privacy issue, see [SECURITY.md](SECURITY.md).

## License

[GNU General Public License v3.0](LICENSE).
