# Entire forge procedure

Use Entire for changes, review findings and merges. DOMAIN.md owns the terms;
this file owns the forge commands and exceptions.

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

## Tickets during the cutover

Until the stacked ticket-migration change lands, GitHub issues remain the ticket
backlog. Read all open issues with `gh issue list -R <owner>/<repo> --state open
--limit 1000`; paginate with `gh api` if the limit is reached. Record the issue URL
in the change's trail body and the helper's `--ticket`. After its last delivery
change merges, close that issue with `gh issue close <number> -R <owner>/<repo>
--comment "Delivered by <change URL>"`. A backing PR body belongs to Entire, so
do not rely on `Closes #N` there. The ticket-migration change replaces this
transition with intent-only trails and migrates the open backlog.

## Open and describe a change

Run `entire trail create --title "<Conventional Commit title>" --type <type>
--body "<change body>"` from the feature branch; this publishes the branch.
If branch linking fails after creation, retry `trail link` on the created trail
rather than creating a duplicate.

Use [publications.md](../writing/publications.md) for titles and trail bodies,
including `Story:` and `Rigor:`. Update the trail body rather than keeping a
second authored change description on the backing forge.

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

Then run `entire trail merge --dry-run --json`, followed by `entire trail merge`
only when allowed. The dry run exits nonzero when checks, findings, up-to-date
state or configured approvals refuse the merge. Never bypass a refused gate.

This is the one list of `gh` exceptions: GitHub Actions runs/logs; repository
settings and the pre-merge settings read above; backing PR discovery, title and
base edits; Landmark releases and generator-only release PRs; PR media
attachments until Entire has an attachment command; and the bounded ticket and
legacy-ledger cutovers in this file. Never use `gh pr merge` for a new Entire
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
Record delivery against the original ticket. This exception expires separately
for each of the six rounds when it closes; it cannot start another v1 round.
