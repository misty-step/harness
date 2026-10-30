# Entire forge procedure

Use Entire for tickets, backlog, changes, review findings and merges. DOMAIN.md
owns the terms; this file owns their forge procedure.

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

Read the backlog with
`entire trail list --project <forge>/<project> --status open`.
Create a ticket with `entire trail create --no-branch --title "<intent>"
--type <type> --priority <priority> --body "<intent and acceptance>"`.
Types are `bug`, `feature` and `task`; priorities are `urgent`, `high`, `medium`,
`low` and `none`. The current repository scopes the ticket. For work outside any
repository, add `--repo gh/moomooskycow/daybook` and link the trail from the
Daybook note that holds its context. Do not create a second backlog in that note.

Entire has no blocking relation. Record each direct dependency as
`Blocked by: <trail URL>` in the trail body. Read those trails before dispatch.
Use `entire trail update` to maintain intent, priority and lifecycle.

## Open and describe a change

For an existing ticket, publish the feature branch and run
`entire trail link <trail>`. Ticket and change share one trail; do not use
`Closes #N` to connect separate forge objects. Without a ticket, run
`entire trail create --title "<Conventional Commit title>" --type <type>
--body "<change body>"` from the feature branch; this publishes the branch.
If branch linking fails after creation, retry `trail link` on the created trail
rather than creating a duplicate.

Use [publications.md](../writing/publications.md) for titles and trail bodies,
including `Story:` and `Rigor:`. Update the trail body rather than keeping a
second authored change description on the backing forge.

## Review and status

Add agent findings with `entire trail finding add --severity <severity>
-m "<steps, expected, actual, evidence>"`; add `--file` and `--line` when useful.
Use a real `high`, `medium` or `low` severity: omitting it blocks merging. A high
finding is an eligible blocker under [judge](../judge/SKILL.md), not an automatic
reason to fix unrelated work. Resolve a fixed finding with `finding resolve -m`.
Dismiss a ruled-out or deferred finding with `finding dismiss -m`, recording the
ruling or follow-up trail link. Read each subcommand's help for its finding ID.

Read intent and changes with `entire trail show --json`, follow events with
`entire trail watch`, and read finding history with `entire trail finding list
--status any --include-dismissed --freshness any --json`.
Agents do not post, reply to or resolve trail discussions; comments are for
people. Agents share the owner's Entire account, so do not use `trail approve`.
The independent judge's SHIP belongs in the [ship-loop](../ship-loop/SKILL.md)
ledger.

## Merge and forge exceptions

Follow ship-loop's authority and repository release policy. Run
`entire trail merge --dry-run --json`, then `entire trail merge` only when allowed.
The dry run exits nonzero when checks, findings, up-to-date state or configured
approvals refuse the merge. Do not bypass a refused gate or use `gh pr merge`.

For GitHub-backed repositories, Entire creates a backing PR whose title is the
branch name and has no command to edit that title. Before merging, set it with
`gh pr edit <number> --title "<Conventional Commit title>"`. This is an allowed
exception: squash merges use that title, including Landmark's release input.
The trail title alone does not update it.

Other `gh` exceptions are GitHub Actions runs/logs, repository settings,
retargeting a GitHub-backed change's base (`gh pr edit <number> --base`),
Landmark releases and generator-only release PRs, and PR media attachments until
Entire has an attachment command. [Evidence](../verification/evidence.md) owns
artifact retention and delivery; keep its links on the trail. GitHub Actions
workflows stay on GitHub. Leave historical ADRs, postmortems and provenance
citations unchanged.
