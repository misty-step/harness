---
name: boat-workers
description: "Before running builds, test suites, browser QA, untrusted code or long jobs: place them on a fresh Boat worker, or keep platform-specific and quick trusted work where you run."
metadata:
  owner: phaedrus
  prevents: "Heavy and untrusted execution on the operator's machine, a shared coordinator host or a shared bot computer, and agents waiting on the retiring Kaylee dispatcher; Phaedrus, 2026-10-28, docs/decisions/0017-tern-omp-and-boat-workers.md."
  source: "Phaedrus, 2026-10-28: consolidate onto Tern+OMP for local development and lean into Boat-dispatched workers; Phaedrus, 2026-10-29: Grok Bots use Boat but not Tern+OMP; misty-step/workstation@e82812ec29cbef7814db697b6a7b190d8ecf6b8d/skills/remote-execution/SKILL.md; https://docs.boat.dev/cli-reference; https://docs.boat.dev/security; https://docs.boat.dev/billing; https://docs.boat.dev/hosting/firewall; review of misty-step/mistystack#602"
  sunset: "2026-11-27"
---

# Boat workers

Dispatch each unit's heavy or isolated execution to its own
[Boat worker](../../DOMAIN.md). The dispatching agent keeps its loop,
credentials and judgment, and deletes the worker once results are collected.

## 1. Place the work

Use a Boat worker for portable builds, full test suites, browser QA against
running services, Docker, unfamiliar or untrusted code, parallel experiments and
long jobs.

Automated browser suites run on the worker with its Chrome. For browser QA
through your harness's browser tool, run the services on the worker, keep
`boat forward <id> --remote <port>` running as a background process, drive
`localhost`, then stop the forward. Reviewing an already deployed surface needs
no worker.

Hostile or exploit code also needs blocked egress, because a worker reaches the
internet: run it as a separate account without sudo under Boat's
[outbound rules](https://docs.boat.dev/hosting/firewall.md#block-outbound-internet-for-untrusted-code).
A worker alone does not meet the security audit's
[sandbox contract](../security-audit/references/safety.md).

Keep work where you run when the acceptance check needs its platform, a device,
an existing signed-in session or a private network; when the data may not leave
it; or for quick, trusted inspection, edits and targeted inner-loop checks. Your
[harness note](../misty/SKILL.md) states any limits on where you run. A Linux
worker cannot prove macOS, device or GPU behavior.

Inside a Boat worker, run the assigned checks there. Do not create nested
workers or start child agents; return independent work to the dispatcher.

Another sandbox provider is neither a default nor a fallback until a recorded
decision shows a measured need Boat cannot meet.
**Complete when:** each unit's placement is named with its reason.

## 2. Check access and allowance

Read `boat --no-update status --json`, `boat limits --json` and
`boat list --all --json`. Use the Boat credential already available where you
run. Proceed when `canStart` is true, `nextStartDollars` is 0 and
`planIncluded.vmHoursRemaining` covers the whole batch: parallel writers share
one allowance. Bound each worker's lifetime to the job (`boat new --ttl`,
`boat run --timeout`), because a running worker keeps billing after included
time ends. Wallet charges (VM time
past the included hours, paid starts, extra saved snapshots, the AI credentials
proxy), disabled auto-stop, `--keep`, public hosting, purchases, plan changes,
provider connections and new keys need Phaedrus. Without a working credential,
report the missing prerequisite; do not run the job somewhere less isolated.
Live limits, not this skill, own sizes, prices and quotas.
**Complete when:** credential, included capacity, lifetime bound and
authorization are observed.

## 3. Dispatch

One writer owns one worktree, one branch and its own workers; parallel units use
separate workers. Read the live help before first use: `boat run --help`,
`boat new --help`, `boat exec --help`, `boat delete --help`.

- **One bounded job:** create, run and delete in one command with an explicit
  size and timeout:

  ```sh
  boat run --no-env --type small --timeout 600 --push . -- <check>
  ```

  `--push` copies tracked and unignored files; inspect that set for private
  material first. `--no-env` withholds the account's stored secrets; it does not
  make uploaded files safe.
- **Multi-step work:** start with `boat new --no-env --ttl <seconds> --json`,
  keep the `bx_...` ID from its `ready` event and pass that ID to every
  `boat exec`; `current` is terminal-local. `boat exec` stops a command after
  30 seconds unless `--timeout` sets the job's bound; use `--detach` with
  `--status` or `--attach` for long processes. Delete with
  `boat delete <id> --yes --json`, which needs `--yes` without a terminal.

**Complete when:** each worker's command, size, timeout and ID are recorded.

## 4. Collect and delete

Keep each command's exit status and output as evidence; a failed check stays
failed. Return deliverables before deletion: push the branch, publish artifacts
or copy files back. Delete your worker, retain the deletion result and confirm
its ID is absent from `boat list --all --json` with `pageInfo.hasMore` false;
running-only inventory misses stopped and errored sandboxes. The CLI cannot read
further pages, so more pages leave cleanup unverified. Stop is not deletion.
Reconcile an interrupted launch's ID before retrying, and never delete another
agent's sandbox.
**Complete when:** evidence is retained and every owned ID is gone.

## Credentials and agents inside workers

Keep owner credentials, auth stores and agent homes off workers and snapshots.
The dispatching agent runs checks with `boat exec`; it does not need a second
agent in the worker. An agent inside a worker needs an approved credential route
and receives only the guidance it needs: a new worker inherits neither this
method nor a bot's saved skills.

## Reference

Search Boat's documentation through a configured docs MCP or
https://docs.boat.dev/llms.txt; each page has a Markdown copy ending in `.md`.
The docs MCP reads documentation and cannot run workers; its feedback tool
contacts Boat and needs Phaedrus. Boat's recommended skill pack carries stale
domains, sizes and limits; do not install it over this procedure.
