# Entire forge procedure

Use Entire for tickets, backlog, changes, review findings and merges. DOMAIN.md
owns the terms; this file owns the forge commands, scope and exceptions.

## Prerequisites and selectors

Install the `entire` CLI and use the owner's existing saved login. Check it with
`entire auth status`. Read `entire agent-help` and
`entire agent-help trail <subcommand>` before using an unfamiliar command; do not
guess flags. Trail commands need network and OS keyring access. In a sandbox,
request unsandboxed execution for them. A blocked keyring or network is not a
logout; do not run `entire login` from an agent session.

A trail number and a change number are different selectors. Use `<repo>/<number>`
for a specific change and the project trail number for intent. Convert pasted
URLs to selectors using `agent-help`; do not pass URLs to the CLI. Add
`--project <forge>/<project>` outside the origin's namespace. Link the trail or
current change URL printed by `entire trail show`, not a constructed URL.

## Tickets and backlog

Create a ticket with `entire trail create --no-branch --title "<intent>"
--type <bug|feature|task> --priority <urgent|high|medium|low|none>
--body "<intent and acceptance>"`. The current repository scopes the ticket.
For work outside any repository, use `--repo gh/moomooskycow/daybook` and link
the trail from the Daybook note that holds its context. That note is not a second
backlog; keep private context in its approved destination.

Read a repository's backlog with:

```sh
entire trail list --project <forge>/<project> --repo <forge>/<project>/<repo> --status open --limit 100 --json
```

Follow every `nextPageToken` with `--page-token <token>`, preserving project,
repository and status filters until the token is absent. Omit `--repo` only for
an intentional whole-project read. For each candidate, read `entire trail show
<trail-number> --project <forge>/<project> --json` for its intent, acceptance,
dependencies and `changes[]`. Intent-only trails are unstarted tickets; trails
with open changes are delivery in progress. Old mirrored delivery trails with
only merged changes and no outstanding intent are history, not new tickets.
Do not bulk-close unrelated historical trails during a backlog read.

Entire has no blocking relation. Record each direct dependency as
`Blocked by: <trail URL>` in the trail body and read those trails before dispatch.
Use `trail update` for priority and intent. The
[ship-loop merge step](../ship-loop/SKILL.md#3-merge-and-watch) owns delivery
closure; release recovery reopens the ticket.

## Open and describe a change

For an existing ticket, publish the feature branch and run
`entire trail link <trail-number> --branch <branch>`. Ticket and change share
one trail; do not use `Closes #N` to connect them. Without a ticket, run
`entire trail create --title "<Conventional Commit title>" --type <type>
--body "<change body>"` from the feature branch; this publishes the branch.
If branch linking fails after creation, retry `trail link` on the created trail
rather than creating a duplicate.

Use [publications.md](../writing/publications.md) for titles and trail bodies,
including `Story:` and `Rigor:`. Keep one authored description on the trail,
not another on the backing forge.

**Body updates replace the whole description.** Before `trail update --body`,
read the full current body with `trail show --json`. Change only the intended
section, retaining the ticket's intent, acceptance criteria, every `Blocked by:`
line and migration provenance unchanged. Add evidence or stack-cut points in
their named sections; do not replace the ticket with a report template.
Coordinate one body writer; if the body changed since the read, reread and
reconcile instead of writing the stale copy. Read back the whole result before
reporting success.

## Review and status

Add agent findings with `entire trail finding add --trail <repo>/<change-number>
--project <forge>/<project> --severity <severity> -m "<steps, expected, actual,
evidence>"`; add `--file` and `--line` when useful. Explicit selectors also work
from a detached checkout. Use a real `high`, `medium` or `low` severity: omitting
it blocks merging. A high finding is an eligible blocker under
[judge](../judge/SKILL.md), not an automatic reason to fix unrelated work.
Resolve a fixed finding with `finding resolve -m`. Dismiss a ruled-out or
deferred finding with `finding dismiss -m`, recording the ruling or follow-up
ticket link. Read each subcommand's help for its finding ID.

Read intent and changes with `entire trail show --json`, follow events with
`entire trail watch`, and read finding history with `entire trail finding list
--status any --include-dismissed --freshness any --json`. The default list hides
resolved, dismissed and stale findings; none can be omitted from ledger replay.
Agents do not post, reply to or resolve trail discussions; comments are for
people. Agents share the owner's Entire account, so do not use `trail approve`.
The independent judge's verdict belongs only in the
[ship-loop](../ship-loop/SKILL.md) ledger, not a second verdict finding.

## Merge and forge exceptions

Follow ship-loop's authority and repository release policy. On GitHub-backed
repositories, discover the backing PR from the change's branch, never its change
number:

```sh
gh pr list -R <owner>/<repo> --head <branch> --state open --json number,url,headRefName
```

Require exactly one PR for that branch. Entire creates it with the branch name
as its title and has no command to edit that title. Set the discovered backing
PR number with `gh pr edit <backing-PR-number> -R <owner>/<repo> --title
"<Conventional Commit title>"`. The trail title alone does not update it.

Entire has no merge-method flag. Phaedrus made all 36 non-archived `misty-step`
repositories squash-only on 2026-10-30, with `squash_merge_commit_title=PR_TITLE`.
Before every GitHub-backed merge, including another owner's repository, require
these current settings:

```sh
gh api repos/<owner>/<repo> --jq '{allow_squash_merge,allow_merge_commit,allow_rebase_merge,squash_merge_commit_title}'
```

Proceed only when `allow_squash_merge=true`, `allow_merge_commit=false`,
`allow_rebase_merge=false` and `squash_merge_commit_title="PR_TITLE"`. Otherwise
stop; do not guess which method Entire will choose or change settings without
the owner's authorization. A native repository needs its own documented merge
policy; the GitHub squash guarantee does not apply to it.

Then run `entire trail merge <repo>/<change-number> --project <forge>/<project> --dry-run --json`.
Confirm the dry run's change and `headSha` match the judged change and SHA.
Only when they match and the dry run allows it, run
`entire trail merge <repo>/<change-number> --project <forge>/<project> --json`.
The dry run exits nonzero when checks, findings, up-to-date state or configured
approvals refuse the merge. Never bypass a refused gate.

This is the one list of `gh` exceptions: GitHub Actions runs/logs; repository
settings and the pre-merge settings read above; backing PR discovery, title and
base edits; Landmark releases and generator-only release PRs; PR media
attachments until Entire has an attachment command; and the bounded issue
migration and legacy-ledger cutovers in this file. Never use `gh pr merge` for a new Entire
change. [Evidence](../verification/evidence.md) owns retention and delivery;
keep its links on the trail. GitHub Actions workflows stay on GitHub. Leave
historical ADRs, postmortems and provenance citations unchanged.

## Finish the six open v1 review rounds

The new helper fails closed with exit 2 and the backing PR's v1 ledger path when
it finds a trusted `<!-- ship-loop:event v1 -->` PR-comment ledger. This is not
round 0: do not run a new `init`, copy events into findings or reset the fix cap.
A PR without an Entire mirror still owns its existing round.

The SPLIT ruling measured these six still-open rounds on 2026-10-30:

| Backing PR | Existing phase | Delivery path |
| --- | --- | --- |
| [hundred#8](https://github.com/misty-step/hundred/pull/8) | shipped | Existing Entire change `hundred/2` |
| [liminal#40](https://github.com/misty-step/liminal/pull/40) | shipped | Discover its existing change by branch |
| [tach#515](https://github.com/r90group/tach/pull/515) | verify | No Entire mirror at the ruling |
| [tach#521](https://github.com/r90group/tach/pull/521) | verify | No Entire mirror at the ruling |
| [tach#522](https://github.com/r90group/tach/pull/522) | verify | No Entire mirror at the ruling |
| [tach#605](https://github.com/r90group/tach/pull/605) | shipped | No Entire mirror at the ruling |

Finish each round with the immutable pre-cutover helper from commit
`924af6c000d84866af2541a015608f9938b0f963`, using its existing `--pr <PR URL>`
interface. Extract `skills/ship-loop/scripts/ship-loop.ts` with `git show` into a
run-scoped cache directory, then run `bun <cached-v1-helper> status --pr <PR URL>
--json` before resuming. Use that helper's phase-checked prompts and records;
retain its review threads, accepted head, existing reports and spent fix round.
Do not initialize a replacement ledger. No permanent v1 helper is installed.

After SHIP at the current head and passing affected checks, use an existing
Entire mirror's merge gates where available. If a PR still has no mirror, finish
that named PR only with `gh pr merge <number> -R <owner>/<repo> --squash`, after
the same title and squash-only settings checks above. Stop if those settings do
not hold; the authorization for `misty-step` settings does not cover `r90group`.
Record delivery against the original ticket. If its GitHub issue was migrated,
follow its migration comment to the intent trail and apply ship-loop's closure
step there; the issue's migration closure is not delivery. This exception
expires separately for each of the six rounds when it closes; it cannot start
another v1 round.

## Migrate the open GitHub issues

Phaedrus authorized one intent-only trail per open issue in every non-archived
`misty-step` repository, plus `moomooskycow/daybook` when it has open issues.
Use [migrate-issues.ts](scripts/migrate-issues.ts); run only one migration writer.
It snapshots the complete initial issue set, preserves each title and body,
maps explicit type/priority labels and records the issue URL as the first
provenance line. The snapshot and issue-to-trail mapping stay in a private
run directory under `~/.cache/tmp`, not Git.

From the checkout root, use the same snapshot and mapping for every step:

```sh
RUN="$HOME/.cache/tmp/entire-issue-migration"
mkdir -p "$RUN"
chmod 700 "$RUN"
bun skills/misty/scripts/migrate-issues.ts --snapshot "$RUN/snapshot.json" --mapping "$RUN/mapping.json" --all --dry-run
bun skills/misty/scripts/migrate-issues.ts --snapshot "$RUN/snapshot.json" --mapping "$RUN/mapping.json" --repo misty-step/landmark
bun skills/misty/scripts/migrate-issues.ts --snapshot "$RUN/snapshot.json" --mapping "$RUN/mapping.json" --repo misty-step/landmark --verify
bun skills/misty/scripts/migrate-issues.ts --snapshot "$RUN/snapshot.json" --mapping "$RUN/mapping.json" --all --max-failures 10
bun skills/misty/scripts/migrate-issues.ts --snapshot "$RUN/snapshot.json" --mapping "$RUN/mapping.json" --all --verify
```

Inspect the dry-run plan for every issue before the pilot. Require the pilot's
verification to show its issue count equals `migrated` and `trails_found`, with
no open issues, mismatches or duplicates, before running the rest. A failed
repository remains visible in the plan; never silently narrow the snapshot.

Each create uses a deterministic `--idempotency-key`, and each run searches all
trail pages and lifecycle states for that issue's exact provenance line.
Cross-links in copied issue text are mentions, not ownership. Duplicate claims,
changed intent or a wrong repository scope fail closed. The script saves a
created trail's mapping immediately, verifies its intent-only shape and full
intent on `trail show`, then closes the GitHub issue as `not planned` with a
comment linking the trail. That closure means moved, not delivered.

Rerun the same command and mapping after interruption; never discard the
mapping or recreate a trail by hand. `--limit` and `--max-failures` bound a run.
An idempotency-key refusal or an unonboarded repository is a reported failure,
not permission to omit the key, widen credentials or use another repository.
Repository onboarding belongs to the owner. Preserve its failed issue open;
after the prerequisite is fixed, resume with `--repo <owner>/<repo>`.

The final read-only `--verify` compares the original snapshot to live issues,
mapped trails and closure comments, detects duplicate claims and lists newly
opened issues outside the snapshot. Complete migration requires every original
issue mapped to exactly one intent-only trail and closed with its link, with
zero failures, open issues, mismatches or duplicates. New open issues must be
accounted for before claiming the live backlog fully migrated. Retain the
counts and mapping outside Git and link the result from the migration trail.
