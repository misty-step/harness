# 0019: Entire is the forge interface

Status: accepted, 2026-10-30.

## Context

Phaedrus, 2026-10-30:

> please use entire instead of gh wherever possible. make this a core piece of
> mistystack, and any other references that need be

> entire for *everything*. when there is no repo, we have trails in daybook.

He chose to migrate ship-loop's ledger now rather than leave it on GitHub.
The independent ruling on [trail 140](https://entire.com/gh/misty-step/-/trails/140/changes/mistystack/32)
split delivery into changes/review/merge first (critical rigor), then tickets and
backlog (standard rigor), stacked on that cutover. Unit B replaces the remaining
GitHub ticket store with intent-only trails.

Misty Step repositories are mirrored into Entire (`gh/misty-step`,
`gh/moomooskycow`) or hosted there (`et/mistystep`). The previous method opened,
reviewed and merged GitHub pull requests, tracked GitHub issues, and kept its
review ledger in PR comments written through `gh api`.

## Evidence

Measured on trail 140 and change `workstation/6` with Entire CLI 0.12.2:

- `entire trail create` publishes a branch as a change. A GitHub-backed
  repository gets a backing pull request titled with the branch name. No Entire
  command sets that title, and editing the GitHub title does not update the
  change's title.
- An agent session can add, resolve and dismiss findings. Findings record the
  writer's account (`actorId`) and a time-ordered ULID. The CLI documents a
  **24-hour** retention window for `--client-id`; it is not a permanent event key.
- Unresolved findings without severity or with `high` severity block merge at
  the measured gate threshold. `medium` and `low` do not. Resolved, dismissed
  and stale findings need `--status any --include-dismissed --freshness any`
  to remain visible to replay.
- `entire trail comment` refuses agent writes. Every agent acts as Phaedrus's
  Entire account, so an account approval cannot establish judge independence.
- `entire trail merge` checks the gates and uses the backing repository's
  allowed merge method. It has no method flag. The owner approved and verified
  squash-only settings on all 36 non-archived `misty-step` repositories on
  2026-10-30. The [merge procedure](../../skills/misty/entire.md#merge-and-forge-exceptions)
  requires a current settings read before merging, not reliance on that snapshot.

## Decision

- **Entire owns changes, findings and merge.** The
  [forge procedure](../../skills/misty/entire.md) is the one home for commands,
  backing-forge exceptions, ticket scope and cutover rules. DOMAIN.md owns terms.
- **Migrated tickets are trails.** Within the forge procedure's migrated scope,
  intent-only trails form the backlog and delivery changes link to that same
  trail. Other projects retain their established ticket tracker until migrated.
  The procedure owns scope and the authorized issue migration, not a second
  copy of ticket state.
- **Delivery closes intent, recovery reopens it.** Ship-loop closes a ticket
  only after its last change merges and acceptance is delivered. Release-watch
  reopens intent removed by recovery. Report/body updates retain acceptance
  and dependency lines.
- **ship-loop's ledger lives in findings.** Each event is a low-severity finding
  carrying a marker and JSON, keyed by sequence and content, resolved at once.
  Full-history replay and content hashes provide durable retry identity after
  the server's client-id window expires. Resolution is part of the write's
  success contract; a failed resolution exits nonzero and a rerun repairs it.
  The helper takes `--change <URL>` and reports `ship-loop.status.v2`.
- **Existing v1 rounds keep their authority.** A trusted PR-comment ledger
  makes the new helper exit 2 with its legacy path, never return a new round.
  The forge procedure names the six open rounds and their immutable-helper
  completion path, including PRs without Entire mirrors. There is no installed
  compatibility writer and no reset of the one-fix-round limit.
- **The ledger owns the verdict.** Reviewers record findings at real severity.
  The conductor resolves or dismisses them according to the independent ruling.
  The judge returns the verdict for the helper, not a duplicate verdict finding
  or account approval.

## Trust and limits

The trust anchor is the **change author**, not the parent ticket author.
Measured with CLI 0.12.2, `trail finding list --json` exposes the selected
change as `.trail`, including `.trail.author.id`; the finding's `actorId` uses
the same account ID. The helper reads that author even if the parent trail has
another author. A bot mirror with no change author fails closed before a write;
it does not fall back to the ticket author. Findings from other accounts do not
count as ledger events. All agents currently share the owner's account, so
thread IDs and the workflow enforce role independence, not account separation.

Findings are mutable, not an append-only server log. Hash validation detects an
edited event that no longer matches its content key, but a same-account actor
can rewrite both payload and hash. This retains the existing shared-account
trust boundary rather than claiming protection against its owner.

## Consequences

The core points to the forge procedure instead of duplicating its exceptions.
Historical records and provenance citations keep their original meaning.
New review rounds use Entire findings only; finishing a named old round does not
create a second live store for the same round.

Revisit when Entire adds agent principals, editable backing PR titles,
attachments or an agent-writable append-only event store.
