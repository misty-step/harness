# Release convention

Status: accepted 2026-10-14. This is the one implementation convention for
versions, changelogs and release notes in every repository we ship, client work
included. The [foundations reference](https://foundations.mistystep.io/) says
why we deploy continuously and keep useful notes and maintained versions; this
page says how. A repository's ADR records its local choices (release units,
baseline, any existing pre-1.0 policy) and links here instead of restating it.
Change this convention with a normal pull request to this file.

## Pipeline

```text
reviewed PR with a Conventional Commit title
  -> squash commit on the protected default branch
  -> one generator per release unit decides the SemVer bump
  -> release PR containing only generator output (versions, CHANGELOG.md)
  -> merged release PR: tag and GitHub Release with the same notes
  -> deployment, separately: /changelog built from the deployed revision
```

The formats are [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
and [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Use a maintained
generator; never build a release service.

## Rules

1. **One authority.** A release unit is one independently deployable or
   installable program. Exactly one generator decides its version and notes.
   Version files and manifests are generator output, never edited by hand. A
   repository with several release units names them in its ADR and uses the
   generator's multi-package support, not hand-synchronized copies.
2. **Commits are the input.** The generator reads the commits merged to the
   protected default branch since the previous release tag. Release units allow
   squash merges only, with the pull request title as the commit title
   (`squash_merge_commit_title: PR_TITLE`) and an empty commit body
   (`squash_merge_commit_message: BLANK`), so the reviewed title is the
   generator's entire input. A title check rejects
   non-conventional titles before merge. It reads only the title, passed
   through an environment variable rather than interpolated into a script, and
   builds nothing.
3. **Titles are the notes.** Write `type(scope): summary` for the person using
   the program: what changed, and what they gain or must do. Titles are
   published, so they carry no ticket IDs, internal paths or hosts,
   credentials or client details. `fix` is a patch, `feat` a minor, and `!` in
   the title marks a major. Put migration and rollback steps in the PR
   description; the generated notes link to the PR.
   `chore`, `docs`, `test`, `build`, `ci`, `refactor` and `style`
   changes never cut a release on their own.
4. **Baseline once.** The previous immutable release tag is the baseline. When
   adopting a generator, record the starting version and baseline commit in
   the ADR (release-please: the manifest version and `bootstrap-sha`). Never
   infer them from a package version, the newest-looking tag or an empty
   checkout, and never reset versions or retag history. Existing pre-1.0
   products keep their documented policy; new integrations take the generator
   defaults, so a breaking change takes 0.x to 1.0.0. Set a deliberate version
   with the generator's override (release-please: a reviewed `Release-As:`
   commit footer), never by editing version files.
5. **Release PR, no bypass.** Version and changelog changes land only through a
   release PR that contains nothing but generator output. The release bot never
   pushes to the default branch and never uses an admin or ruleset bypass. Fix
   wrong notes at their source (release-please: a `BEGIN_COMMIT_OVERRIDE` block
   in the merged PR's body), not by editing the release PR.
6. **Exact-head checks.** A release PR merges only after the repository's real
   CI passed on its current head commit. `GITHUB_TOKEN`-created or updated PRs
   create native `pull_request` runs that require workflow approval. Either
   open the PR with a release App token the repository already uses, or approve
   those native runs through GitHub's workflow-approval API. The existing
   `GITHUB_TOKEN` with `actions: write` can do this; no human shipping gate is
   needed. Scope approval to the generator's same-repository PR, its current
   head SHA and the configured CI workflows; refuse missing, foreign or moved
   runs, and do not restart already-started runs. `workflow_dispatch` and
   `repository_dispatch` jobs can execute real CI but their checks do not
   satisfy required PR checks. Never post a passing stand-in, create a PAT or
   copy credentials for this. See GitHub's [trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
   and [required-check eligibility](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
7. **Merge promptly.** A release PR lists changes that were reviewed when they
   merged, so it needs no second review. The merging agent checks that the
   version matches the included commits and that the notes hold nothing
   private, then merges as soon as checks pass. An open release PR is
   unfinished work, not a queue for a person.
8. **Publish in one run.** Tags and releases created with `GITHUB_TOKEN` trigger
   no further workflows. Build and attach release artifacts from the tagged
   commit in the run that created the release (release-please output
   `release_created`). Serialize release runs with a `concurrency` group that
   never cancels, so an older run cannot overwrite a newer release.
9. **Deployment stays separate.** A commit that passes its gates deploys whether
   or not it has been released. A program has one deploy path, and a hosting
   provider's Git integration counts as one. A GitHub Release records reviewed
   source, not a deployment. Rolling back code does not roll back data or
   credentials. Release and deploy failures alarm through the existing incident
   path, not a second one.
10. **Reachable notes.** Every release is a GitHub Release whose notes come from
    the same version decision as its changelog entry. A program with a site
    serves `/changelog`, linked from its navigation and rendered at build time
    from the canonical notes of the deployed revision (CHANGELOG.md, or the
    generator's existing release record), so it lists the releases inside the
    serving build. No GitHub credential reaches a browser, and no service
    exists only to serve notes. An existing `/releases` page may remain as an
    alias. Private sites keep their access boundary. A program that reports
    its revision (health endpoint, `--version`) reports its version beside the
    full commit SHA.
11. **Custody wins.** Existing release custody, holds and tenant boundaries
    override this convention. Under a hold, release automation is proposed to
    the custodian as source only, and nothing merges, retries, dispatches or
    deploys. Release tooling never touches client data.

## Generators

New integrations use
[release-please](https://github.com/googleapis/release-please-action) in
manifest mode, pinned to the full commit SHA of a reviewed release with the
version in a trailing comment, with the strategy for the program's language.

Working [Landmark](https://github.com/misty-step/landmark),
[semantic-release](https://github.com/semantic-release/semantic-release) and
release-please integrations stay when they meet the rules above; replacing one
only for uniformity is out of scope. Fix these known gaps in place, never by
adding a second generator:

- A floating action tag such as `@v4`: pin the full SHA.
- A release commit pushed straight to the default branch, as semantic-release's
  git plugin does: publish the tag and GitHub Release only, or move to a release
  PR.
- A hand-maintained changelog beside generated notes: keep one artifact.
- Model-written or paid notes: optional only, with a deterministic fallback
  that is useful on its own.

## Adoption

Adopt per release unit in one small pull request: generator configuration,
release workflow, title check, `/changelog` where there is a site, and the
ADR, with `squash_merge_commit_title: PR_TITLE`,
`squash_merge_commit_message: BLANK` and default-branch protection applied.
Before merging it, run the actual generator, not an imitation, on patch,
minor, breaking and no-release inputs, and show that a repeated run changes
nothing and that a missing baseline, a moved head and failed or skipped CI
each refuse. Show the release PR getting exact-head CI.
Walk the stories in the repository's SPEC.md, recording missing stories as
gaps rather than inventing them. Prove rollback on a disposable preview, never
on client data. Inspect desktop and mobile screenshots of `/changelog` built
from synthetic or public content.

Adoption is complete when a real reviewed merge has produced the expected
version, a merged release PR (where the generator uses one), an immutable
GitHub Release, a matching changelog entry and a live `/changelog` at the
deployed revision. Record the expected and actual version and the PR, head,
CI, release, provider revision and HTTP readbacks. A dry run or an open pull
request is not adoption.
