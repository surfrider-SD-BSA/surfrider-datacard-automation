# Contributing

Thanks for helping out. This project is maintained by Surfrider Foundation volunteers, so
turnaround on reviews depends on people's day jobs. Small, focused pull requests get merged
fastest.

## Before you file anything: no real volunteer data

Scanned data cards and generated spreadsheets contain volunteer names, and sometimes contact
details and information about minors. Do not attach them to issues, pull requests, or commits.

When you need to show a problem, use one of these instead:

- A redacted screenshot with names blacked out.
- A hand-made sample card with fake data.
- The error message and the row/column numbers, with no cell contents.

If real data does get committed, say so immediately in an issue tagged `privacy` and see
[SECURITY.md](SECURITY.md). Deleting the file in a later commit does not remove it from history.

## Ways to contribute

- **Report a bug** — [open an issue](../../issues/new/choose) with the bug report template.
- **Request a feature** — same place, feature request template.
- **Test with your chapter's data card** — chapters use different card layouts and template row
  orders. Telling us what breaks on yours is the single most useful contribution.
- **Improve the docs** — setup instructions written for non-technical volunteers are as valuable
  as code.
- **Write code** — see below.

## Development setup

```bash
git clone https://github.com/surfrider-SD-BSA/surfrider-datacard-automation.git
cd surfrider-datacard-automation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pre-commit install
```

`pre-commit install` sets up the hooks that run the linter and the volunteer-data check before
each commit. It is worth the thirty seconds — it catches the things CI would otherwise fail on.

## Making a change

1. **Open an issue first** for anything beyond a typo. It avoids two people solving the same
   problem, and it gives the change a place to be discussed before code exists.
2. **Branch off `main`.** Name it `<type>/<short-description>`, matching the commit types below —
   for example `fix/tally-mark-miscount` or `docs/setup-for-windows`.
3. **Keep the pull request focused.** One concern per PR. A formatting sweep mixed into a bug fix
   makes the bug fix impossible to review.
4. **Update the docs in the same PR** if behavior changed.
5. **Add a CHANGELOG entry** under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything
   a user would notice.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary in the imperative>

<optional body explaining why, not what>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.

```
fix: count five-bar tally groups as 5, not 4

The regex matched the four vertical strokes but not the diagonal
crossbar, so every complete group was short by one.
```

## Code style

- **Python** — [ruff](https://docs.astral.sh/ruff/) handles both linting and formatting. Run
  `ruff check .` and `ruff format .` before pushing, or let pre-commit do it.
- **Shell** — [shellcheck](https://www.shellcheck.net/) clean. Scripts start with
  `set -euo pipefail`.
- **Python version** — the tool has to run on the Python that ships with macOS, so target 3.9.
  Do not use syntax newer than that without raising the floor in `pyproject.toml`, the README, and
  the CI matrix together.

## Tests

Tests live in `tests/` and run with `pytest`.

New code needs a test. Bug fixes need a test that fails before the fix and passes after — that is
the only proof the bug is actually gone. Extraction accuracy work should use fixture PDFs built
from fake data, never real cards.

CI currently skips the test step when `tests/` does not exist. That guard comes out the moment the
first test lands.

## Pull request review

Every change to `main` goes through a pull request. Direct pushes are blocked.

To merge, a PR needs:

- All CI checks passing.
- No unresolved conversations.
- A branch up to date with `main`.

Review is requested automatically from the maintainers team on every pull request. An approving
review is **not** currently enforced by branch protection: the project has few enough active
maintainers that requiring a second person would stall it. Outside contributions still get reviewed
before merge — that is a commitment from the maintainers, not something the platform enforces. The
requirement moves to one approval once there are enough active reviewers for it not to be a
bottleneck.

Maintainers are not exempt from the rest — the same rules apply to our own PRs.

We squash-merge, so your PR title becomes the commit message on `main`. Write it accordingly.

## Releases

Versions follow [Semantic Versioning](https://semver.org/). Because this tool writes files people
depend on, treat these as breaking changes (major bump):

- Any change to the output spreadsheet layout or file naming.
- Any change to the extraction JSON schema.
- Raising the minimum Python version.

To cut a release, a maintainer moves the `## [Unreleased]` entries in `CHANGELOG.md` under a new
version heading, tags the commit `vX.Y.Z`, and publishes a GitHub release with those notes.

## Questions

Open a [discussion or issue](../../issues). If you are a Surfrider chapter volunteer trying to use
the tool rather than change it, start with the [README](README.md) — and if the README did not
answer your question, that is a documentation bug worth filing.
