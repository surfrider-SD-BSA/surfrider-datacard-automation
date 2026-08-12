# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Changes to the output spreadsheet
layout, the output file naming scheme, the extraction JSON schema, or the minimum Python version
count as breaking.

## [Unreleased]

### Added

- **The implementation.** A browser-only tool: drop a scanned PDF, check each
  cell against a picture of it, download the chapter's spreadsheet. No server,
  no account, no API key; the scan never leaves the machine.
- Page alignment that generalizes across chapters' scanners — 1,606 pages, 28
  scans, 10 beaches, nothing refused — verified against the card's printed
  section banners, so a page that will not line up is surfaced rather than
  read from the wrong place.
- Handwriting detection by shape rather than ink volume, which is what makes
  the review list short enough to work through: 730 cells to 453 on a 58-card
  event, with every written value kept.
- Typed values are saved as you go and offered back if the tab closes.
- A digit recognizer, measured and deliberately **not** switched on: 66.3% per
  digit and 84% precision where it is most confident, against the ~99% a
  pre-filled box needs before it stops being a liability. See `HANDOFF.md`.
- CI job for the browser tool: typecheck, tests, and a build that fails if
  anything data-shaped reaches the bundle.

### Fixed

- The built bundle could not start: it requested the cell maps from a path
  `publicDir` does not produce, so the tool worked under the dev server and
  404ed for anyone who ran `npm run build`.
- Builds no longer carry 7.5MB of calibration debug renders, and the dev
  server's dependency cache is no longer tracked. Bundle: 16MB to 6.1MB.
- The volunteer head count is optional. It appears on the leader's card and
  often on no other, so requiring it blocked exports over a number that was
  never written down.

- Contribution guide, code of conduct, and security/privacy policy.
- Issue and pull request templates.
- Continuous integration: ruff lint and format checks, pytest, shellcheck.
- Pre-commit hooks, including a check that blocks committing volunteer data.
- Dependabot for pip and GitHub Actions updates.
- Branch protection runbook at `docs/repo-setup.md`.

### Changed

- Pinned the pre-commit ruff hook to v0.16.2 so it matches the ruff version CI installs.

[Unreleased]: https://github.com/surfrider-SD-BSA/surfrider-datacard-automation/commits/main
