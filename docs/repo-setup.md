# Repository setup runbook

Settings that cannot live in a file, and have to be applied in GitHub itself. Written for whoever
holds **admin** on `surfrider-SD-BSA/surfrider-datacard-automation`.

Each section gives the click-path and the equivalent `gh` command. Use whichever you prefer; they
do the same thing.

## Before you start

- You need the **Admin** role on the repository, or **Owner** on the organization. Write access is
  not enough. Because this repo is org-owned, admin can be granted to more than one person — see
  section 1.
- For the CLI route, install the [GitHub CLI](https://cli.github.com/) and authenticate:

  ```bash
  gh auth login
  gh auth status          # confirm the active account has admin on this repo
  ```

- Set these once so you can copy-paste the rest:

  ```bash
  ORG=surfrider-SD-BSA
  REPO=surfrider-SD-BSA/surfrider-datacard-automation
  ```

The repository is **public**, which matters: branch rulesets, secret scanning, and push protection
are free on public repositories. They require a paid plan on private ones. If this repo is ever
flipped to private, expect these protections to switch off.

---

## 1. Organization setup

Do this first. Section 2's Code Owners rule depends on the team existing, and the org-level
defaults here apply to every repo the chapter adds later.

### Require two-factor authentication

An org account that can publish under the chapter's name should not be one stolen password away
from a takeover.

**UI:** Organization → Settings → Authentication security → **Require two-factor authentication for
everyone in the organization**

Members without 2FA are removed when you enable this, so give people notice first.

### Set base permissions

**UI:** Organization → Settings → Member privileges → Base permissions → **Read**

Read is the right floor for a public repo — the content is public anyway, and write access becomes
something granted deliberately rather than inherited by joining.

While you are on that page, set "Repository creation" to owners only, and leave "Allow members to
create public repositories" off until the chapter decides who speaks publicly under the org name.

### Create the maintainers team

`.github/CODEOWNERS` points at `@surfrider-SD-BSA/maintainers`. Adding or removing a maintainer then
becomes a team-membership change instead of a pull request.

**UI:** Organization → Teams → New team, named `maintainers`. Add members. Then in the repo:
Settings → Collaborators and teams → Add teams → `maintainers` → role **Admin**.

**CLI:**

```bash
gh api -X POST "orgs/$ORG/teams" -f name=maintainers \
  -f description="Maintainers of the data card automation tool" -f privacy=closed

# Grant the team admin on the repo.
gh api -X PUT "orgs/$ORG/teams/maintainers/repos/$REPO" -f permission=admin

# Add a maintainer (role: member or maintainer).
gh api -X PUT "orgs/$ORG/teams/maintainers/memberships/callmeleach" -f role=maintainer
```

> **This is the step that makes CODEOWNERS work.** If the team does not exist, or exists without
> write access to the repo, every line in `.github/CODEOWNERS` is invalid. GitHub then requests no
> reviews — and once "Require review from Code Owners" is on in section 2, nothing can be merged at
> all. Verify by opening `.github/CODEOWNERS` on github.com; invalid owners are flagged inline.

### Set security defaults for new repos

So the next repo the chapter creates starts protected instead of needing this runbook again.

**UI:** Organization → Settings → Code security → Enable for new repositories: dependency graph,
Dependabot alerts, Dependabot security updates, secret scanning, push protection.

---

## 2. Merge settings

Squash-only merges keep `main` a straight line of one commit per pull request, which matches the
Conventional Commits convention in CONTRIBUTING.md.

**UI:** Settings → General → Pull Requests

- Allow squash merging — **on**, with "Default to pull request title and description"
- Allow merge commits — **off**
- Allow rebase merging — **off**
- Always suggest updating pull request branches — **on**
- Allow auto-merge — **on**
- Automatically delete head branches — **on**

**CLI:**

```bash
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY
```

---

## 3. Protect `main`

GitHub has two mechanisms here. **Rulesets** are the current one and what this runbook uses;
classic branch protection still works and is included below as a fallback.

### What we are enforcing

| Rule | Why |
|---|---|
| Pull request required | No direct pushes to `main`, including from admins |
| 1 approving review | A second pair of eyes on every change |
| Dismiss stale approvals on push | An approval covers the code that was approved, not what came after |
| Require review from Code Owners | Governance files get maintainer eyes |
| Require conversation resolution | Review comments cannot be merged past |
| Require status checks to pass | CI is a gate, not a suggestion |
| Require branches to be up to date | Catches "passes alone, breaks together" |
| Require linear history | Matches squash-only merging |
| Block force pushes | History on `main` stays trustworthy |
| Block deletion | Nobody deletes `main` by accident |

> **Two things to get right before turning this on.**
>
> "1 approving review" means you cannot merge your own pull request. With two people in the
> `maintainers` team that is fine and is the point. If realistically one person is active, set the
> approval count to `0` for now — the PR requirement and the CI gate still hold, which is most of
> the value — and raise it to 1 once a second maintainer is actually reviewing.
>
> "Require review from Code Owners" depends on `@surfrider-SD-BSA/maintainers` existing with write
> access (section 1). Enable it before the team exists and every pull request is unmergeable,
> including the one that would fix it.

### UI

Settings → Rules → Rulesets → **New ruleset** → New branch ruleset

- Name: `main protection`
- Enforcement status: **Active**
- Bypass list: **empty** (adding "Repository admin" here defeats the point)
- Target branches: Add target → **Include default branch**
- Enable: Restrict deletions, Block force pushes, Require linear history,
  Require a pull request before merging, Require status checks to pass

Under the pull request rule: required approvals **1**, dismiss stale reviews **on**, require
Code Owners review **on**, require approval of the most recent push **on**, require conversation
resolution **on**.

Under the status checks rule: require branches to be up to date **on**, then add these checks:

```
Lint (ruff)
Test (Python 3.9)
Test (Python 3.11)
Test (Python 3.13)
Shell (shellcheck)
No volunteer data
```

> **A check has to run before you can require it.** GitHub only offers status checks it has seen.
> Open a throwaway pull request first so CI runs once, then come back and add them. If you rename
> a job in `ci.yml`, the required check silently stops matching — update the ruleset in the same
> PR.

### CLI

```bash
gh api -X POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Lint (ruff)" },
          { "context": "Test (Python 3.9)" },
          { "context": "Test (Python 3.11)" },
          { "context": "Test (Python 3.13)" },
          { "context": "Shell (shellcheck)" },
          { "context": "No volunteer data" }
        ]
      }
    }
  ]
}
JSON
```

Verify:

```bash
gh api "repos/$REPO/rulesets" --jq '.[] | {id, name, enforcement}'
gh api "repos/$REPO/rules/branches/main" --jq '.[].type'
```

### Fallback: classic branch protection

Use this only if rulesets are unavailable.

```bash
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint (ruff)",
      "Test (Python 3.9)",
      "Test (Python 3.11)",
      "Test (Python 3.13)",
      "Shell (shellcheck)",
      "No volunteer data"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "required_conversation_resolution": true,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON
```

---

## 4. Protect release tags

Stops a published version tag from being moved or deleted after release.

**UI:** Settings → Rules → Rulesets → New ruleset → New tag ruleset. Target `v*`, enable Restrict
deletions and Block force pushes.

**CLI:**

```bash
gh api -X POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "release tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
```

---

## 5. Security and analysis

**UI:** Settings → Code security. Turn on:

- Dependency graph
- Dependabot alerts
- Dependabot security updates
- Secret scanning
- Push protection — blocks a commit containing a detected secret before it reaches GitHub
- Private vulnerability reporting — this is the channel SECURITY.md points people to

**CLI:**

```bash
gh api -X PUT "repos/$REPO/vulnerability-alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"

gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
```

---

## 6. Actions permissions

CI only needs to read the repository. Nothing here publishes or writes.

**UI:** Settings → Actions → General

- Actions permissions: allow actions created by GitHub, plus verified creators
- Workflow permissions: **Read repository contents and packages permissions**
- Allow GitHub Actions to create and approve pull requests: **off**

**CLI:**

```bash
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=false
```

---

## 7. Labels

The issue templates apply these labels, so they need to exist.

```bash
gh label create bug            --repo "$REPO" --color d73a4a --description "Something is broken"           --force
gh label create enhancement    --repo "$REPO" --color a2eeef --description "New feature or request"        --force
gh label create "needs triage" --repo "$REPO" --color ededed --description "Not yet reviewed"              --force
gh label create compatibility  --repo "$REPO" --color 0e8a16 --description "Chapter card or template fit"  --force
gh label create dependencies   --repo "$REPO" --color 0366d6 --description "Dependency updates"            --force
gh label create ci             --repo "$REPO" --color bfd4f2 --description "Build and automation"          --force
gh label create privacy        --repo "$REPO" --color b60205 --description "Volunteer data exposure"       --force
gh label create documentation  --repo "$REPO" --color 0075ca --description "Docs and setup instructions"   --force
gh label create "good first issue" --repo "$REPO" --color 7057ff --description "Good entry point"          --force
```

---

## Verification

After applying everything, confirm the protection actually bites:

```bash
# 1. A direct push to main must be rejected.
git checkout main && git commit --allow-empty -m "test: should be rejected" && git push
#    Expect: "protected branch hook declined". Then clean up:
git reset --hard origin/main

# 2. Settings read back as expected.
gh api "repos/$REPO" --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, delete_head: .delete_branch_on_merge}'
gh api "repos/$REPO/rules/branches/main" --jq '[.[].type]'

# 3. Open a real pull request and confirm the merge button stays disabled
#    until every required check is green and an approval is in.
```

If step 1 succeeds instead of failing, the ruleset is not active, or the account pushing is in a
bypass list.

---

## Checklist

**Organization (section 1)**

- [ ] `gh auth login` done, active account has admin or org owner
- [ ] Two-factor authentication required org-wide
- [ ] Base permissions set to Read; repository creation restricted
- [ ] `maintainers` team created, members added, granted Admin on this repo
- [ ] `.github/CODEOWNERS` shows no invalid-owner errors on github.com
- [ ] Security defaults enabled for new repositories

**Repository (sections 2–7)**

- [ ] Merge settings applied (squash only, auto-delete branches)
- [ ] Throwaway PR opened so CI reports its check names at least once
- [ ] `main protection` ruleset created and **Active**, bypass list empty
- [ ] Required status checks match the job names in `.github/workflows/ci.yml`
- [ ] `release tags` ruleset created
- [ ] Dependabot alerts, security updates, secret scanning, push protection all on
- [ ] Private vulnerability reporting on
- [ ] Actions workflow permissions set to read-only
- [ ] Labels created
- [ ] Verification step 1 rejects a direct push to `main`

**Content decisions**

- [ ] `CONTACT_EMAIL` replaced in `SECURITY.md` and `CODE_OF_CONDUCT.md`
- [ ] Approval count set (0 or 1)
- [ ] License question resolved (GPL-3.0 vs. the chapters-only restriction)
