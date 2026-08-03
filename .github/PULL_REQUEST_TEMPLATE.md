<!-- The PR title becomes the commit message on main (we squash-merge).
     Write it as a Conventional Commit, e.g. "fix: count tally crossbar as the fifth mark". -->

## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- Link the issue: "Closes #12". If there is no issue, explain the problem here. -->

## How to verify

<!-- Steps a reviewer can follow. Include the before/after values if this touches extraction
     accuracy or spreadsheet output. -->

## Checklist

- [ ] No real volunteer data in the diff, the screenshots, or the test fixtures
- [ ] Docs updated if behavior changed
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` if a user would notice this
- [ ] Tests added or updated (a bug fix has a test that fails without the fix)
- [ ] `ruff check .` and `ruff format .` are clean
- [ ] This is a breaking change — output layout, file naming, JSON schema, or minimum Python
      version changed <!-- delete this line if it does not apply -->
