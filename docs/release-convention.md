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
  -> release PR containing only version files and CHANGELOG.md
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
   (repository setting `squash_merge_commit_title: PR_TITLE`), so the reviewed
   title is exactly what the generator reads. A title check rejects
   non-conventional titles before merge. It reads only the title, passed
   through an environment variable rather than interpolated into a script, and
   builds nothing.
3. **Titles are the notes.** Write `type(scope): summary` for the person using
   the program: what changed, and what they gain or must do. Titles are
   published, so they carry no ticket IDs, internal paths or hosts,
   credentials or client details. `fix` is a patch, `feat` a minor, and `!` or
   a `BREAKING CHANGE:` footer a major; that footer says how to migrate or
   roll back. `chore`, `docs`, `test`, `build`, `ci`, `refactor` and `style`
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
   CI passed on its current head commit. Apart from `workflow_dispatch` and
   `repository_dispatch`, events caused by a workflow's `GITHUB_TOKEN` start no
   workflow runs, so a release PR opened with it gets no automatic CI. Either
   open it with a GitHub App token the repository already uses for releases, or
   run the real CI with `workflow_dispatch` on the release branch, passing the
   expected head SHA, and have CI refuse when the checked-out head differs.
   Never create a personal access token or copy credentials between
   repositories for this.
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
ADR, with the squash-merge setting and default-branch protection applied.
Before merging it, run the actual generator, not an imitation, on patch,
minor, breaking and no-release inputs, and show that a repeated run changes
nothing and that a missing baseline, a moved head and failed or skipped CI
each refuse. Show the release PR getting exact-head CI.
Walk the stories in the repository's SPEC.md, recording missing stories as
gaps rather than inventing them. Prove rollback on a disposable preview, never
on client data. Inspect desktop and mobile screenshots of `/changelog` built
from synthetic or public content.

Adoption is complete when a real reviewed merge has produced the expected
version, a merged release PR, an immutable GitHub Release, a matching
changelog entry and a live `/changelog` at the deployed revision. Record the
expected and actual version and the PR, head, CI, release, provider revision
and HTTP readbacks. A dry run or an open pull request is not adoption.
