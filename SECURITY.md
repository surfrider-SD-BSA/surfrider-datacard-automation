# Security and Privacy Policy

<!-- TODO(maintainers): replace CONTACT_EMAIL below with a real, monitored address,
     and enable private vulnerability reporting under
     Settings → Code security → Private vulnerability reporting. -->

## Supported versions

This project is pre-release. Only the `main` branch is supported. Once versioned releases begin,
this section will list which ones receive fixes.

## Reporting a vulnerability

**Do not open a public issue for a security or privacy problem.**

Use one of these instead:

1. **GitHub private vulnerability reporting** — the Security tab of this repository,
   "Report a vulnerability." This is the preferred route.
2. **Email** — **CONTACT_EMAIL**.

Please include what you found, how to reproduce it, and what you think the impact is. If a
reproduction requires a data card, build a fake one — do not send real volunteer data.

What to expect:

- Acknowledgment within 5 business days.
- An assessment and a fix plan, or an explanation of why it is not a vulnerability, within 30 days.
- Credit in the release notes when the fix ships, unless you would rather stay anonymous.

This is a volunteer project with no bug bounty. We will still take your report seriously.

## Volunteer data is the main risk here

The realistic worst case for this project is not a remote exploit. It is volunteer personal
information ending up in a public Git repository — names, and on some cards contact details and
information about minors.

Two rules follow from that:

- **Scanned cards and generated spreadsheets never get committed.** `input/` and `output/` are
  excluded in `.gitignore`, and a pre-commit hook blocks them as a backstop. Neither is a
  substitute for looking at `git status` before you commit.
- **Issues, pull requests, and test fixtures use fake data.** See
  [CONTRIBUTING.md](CONTRIBUTING.md).

### If volunteer data does get committed

Act fast and treat it as a disclosure, because it is one.

1. **Do not just delete the file in a new commit.** The data stays in Git history and remains
   reachable.
2. **Report it privately** using the channels above. Say which commit and which file.
3. **Assume it is public** if the repository was public and the commit was pushed. Forks, clones,
   and caches are outside our control.
4. A maintainer will purge the history (`git filter-repo`), force-push the rewritten branch,
   rotate anything that needs rotating, and ask GitHub Support to drop cached views. Everyone with
   a clone will need to re-clone.
5. Notify affected volunteers if their information was exposed. Surfrider chapter leadership
   decides how; do not send that notice unilaterally.

## Dependencies

Dependency updates arrive via Dependabot and go through the normal pull request review. Security
updates get merged ahead of feature work.

## Scope

In scope: this repository's code, workflows, and dependencies.

Out of scope: vulnerabilities in Claude Code, the Anthropic API, Microsoft Excel, or Surfrider's
national data systems. Report those to their respective owners.
