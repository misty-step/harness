# 0019: Entire is the forge interface

Status: accepted, 2026-10-30.

## Context

Phaedrus, 2026-10-30:

> please use entire instead of gh wherever possible. make this a core piece of
> mistystack, and any other references that need be

> entire for *everything*. when there is no repo, we have trails in daybook.

He chose to migrate ship-loop's ledger now rather than leave it on GitHub.

Misty Step repositories are mirrored into Entire (`gh/misty-step`,
`gh/moomooskycow`) or hosted there (`et/mistystep`). Until now the method
opened, reviewed and merged work as GitHub pull requests, tracked tickets as
GitHub issues, and kept ship-loop's review ledger in pull-request comments
written through `gh api`.

Measured on trail 140 and change `workstation/6` with Entire CLI 0.12.2:

- `entire trail create` publishes a branch as a change. On a GitHub-backed
  repository it opens a backing pull request titled with the branch name. No
  Entire command sets that title, and editing the GitHub title does not update
  the change's title.
- An agent session can add, resolve and dismiss findings. Each finding records
  the writer's account (`actorId`) and a time-ordered ULID. A `--client-id`
  makes a retried write return the same finding.
- An unresolved finding without a severity blocks `entire trail merge`; a low
  one does not. Resolved and dismissed findings drop out of the default list
  and return with `--status any --include-dismissed --freshness any`.
- `entire trail comment` refuses writes in agent sessions. Every agent acts as
  Phaedrus's Entire account, so an agent's approval is not independent.
- `entire trail merge` checks the gates (checks, findings, up to date, and
  approvals where configured) and merges through the backing pull request, using
  the repository's allowed method. `misty-step/mistystack` allows only squash
  merges titled from the pull request.

## Decision

- **Entire is the forge interface.** Agents open, review, merge and track work
  with `entire trail`. The [misty skill's entire.md](../../skills/misty/entire.md)
  owns the commands; DOMAIN.md names Entire, trail, change and finding.
- **Tickets are trails.** An intent-only trail is a ticket, and its delivery is a
  change on the same trail. Work outside any repository gets an intent-only trail
  scoped to the Daybook repository.
- **ship-loop's ledger lives in findings.** Each event is a low-severity finding
  carrying the event's marker and JSON, keyed by sequence and content, and
  resolved at once. Only findings by the trail's author account count. The
  helper takes `--change <URL>` and reports `ship-loop.status.v2`.
- **Review findings gate the merge.** QA and review record their findings on the
  change at real severity. Fixed findings are resolved and ruled-out ones
  dismissed before `entire trail merge`. The judge's SHIP stays in the ledger;
  agents do not approve trails.
- **`gh` remains only where Entire has no command:** GitHub Actions runs,
  Landmark releases, repository settings, a GitHub-backed change's backing PR
  title and base, and PR media attachments for evidence.

## Consequences

- The core gains one line that points to entire.md, which keeps the core small.
- GitHub-backed repositories need squash-only merges titled from the pull
  request, so a change lands as one Conventional Commit. The builder sets the
  backing PR title with `gh pr edit` until Entire can set it.
- The ledger shares Entire's single agent identity. "Only the author counts"
  means "only this account counts", as it did with the shared `gh` token.
- Historical records and provenance citations of pull-request and issue numbers
  stay as they were.
- Revisit when Entire adds agent principals, change titles, attachments or an
  append-only event record agents can write.
