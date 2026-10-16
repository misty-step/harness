# 012: Retain Landmark and native release promotion

- Status: accepted
- Date: 2026-10-15

## Context

One Harness clone records compatible shared, Pi and OMP source. The generated
release PR stayed open while verified source accumulated. Its existing release
App already opens PRs that trigger native CI; another generator or credential
would not fix the missing merge.

## Decision

Keep one root Landmark release unit and follow the
[release convention](../release-convention.md). Native GitHub auto-merge waits
for required checks on generated release PRs. Squash-only merges use PR_TITLE
and BLANK; branch protection requires current-base verification and the
Conventional Commit title check, with no bypass or second release review.

The immutable baseline is v0.2.0 at
371658088d55357f5394e910828d918fe66accdc. Keep Landmark's existing pre-stable
policy: features and fixes bump patch; breaking changes bump minor. The root
CHANGELOG.md and GitHub Release share the generator's exact notes. Component
changelogs are historical, not additional release streams.

## Consequences

Release metadata does not install a host. Workbench owns the existing fixed
repository-install route and managed-byte readback. Do not add an SSH installer,
replace runtimes or restore HOME, credentials or accepted state. Compatible
host promotion needs retained prior source and exercised native rebind recovery;
the current route reports repository rollback unavailable, so this decision
makes no claim that host CD or recovery is delivered.

Revisit when Workbench exposes verified prior-source recovery or a component
becomes independently installable and needs its own release unit.
