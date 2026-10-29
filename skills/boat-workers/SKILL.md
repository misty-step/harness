---
name: boat-workers
description: "Before running builds, test suites, browser QA, untrusted code or long jobs: place them on a fresh Boat worker, or keep native-platform and quick trusted work local."
metadata:
  owner: phaedrus
  prevents: "Heavy and untrusted execution on the operator's machine or a shared coordinator host, and agents waiting on the retired Kaylee dispatcher; Phaedrus, 2026-10-28, docs/decisions/0017-tern-omp-and-boat-workers.md."
  source: "Phaedrus, 2026-10-28: consolidate onto Tern+OMP for local development and lean into Boat-dispatched workers; misty-step/workstation@e82812ec29cbef7814db697b6a7b190d8ecf6b8d/skills/remote-execution/SKILL.md; https://docs.boat.dev/cli-reference; https://docs.boat.dev/security; https://docs.boat.dev/billing"
  sunset: "2026-11-27"
---

# Boat workers

A Boat worker is a fresh Boat sandbox that one agent dispatches for one unit of
execution. The dispatching agent keeps its loop, credentials and judgment; the
worker runs commands and is deleted once its results are collected.

## 1. Place the work

Use a Boat worker for portable builds, full test suites, browser QA against
running services, Docker, unfamiliar or untrusted code, parallel experiments and
long jobs.

Run natively when the acceptance check needs the native platform, a local
device, an existing signed-in session or a private network; when the data may
not leave the machine; or for quick, trusted inspection, edits and targeted
inner-loop checks. A Linux worker cannot prove macOS, device or GPU behavior.

Inside a Boat worker, run the assigned checks there. Do not create nested
workers or start child agents; return independent work to the dispatcher.

Another sandbox provider is neither a default nor a fallback until a recorded
decision shows a measured need Boat cannot meet.
**Complete when:** each unit's placement is named with its reason.

## 2. Check access and allowance

Read `boat --no-update status --json`, `boat limits --json` and
`boat list --all --json`. Use the existing native login. Proceed when
`canStart` is true, `nextStartDollars` is 0 and `planIncluded.vmHoursRemaining`
covers the job. Wallet charges (VM time past the included hours, paid starts,
extra saved snapshots, the AI credentials proxy), purchases, plan changes,
provider connections and new keys need Phaedrus. Without a working login,
report the missing prerequisite; do not run the job somewhere less isolated.
Live limits, not this skill, own sizes, prices and quotas.
**Complete when:** login, included capacity and authorization are observed.

## 3. Dispatch

One writer owns one worktree, one branch and its own workers; parallel units use
separate workers. Read the live help before first use: `boat run --help`,
`boat new --help`, `boat exec --help`.

- **One bounded job:** create, run and delete in one command with an explicit
  size and timeout:

  ```sh
  boat run --no-env --type small --timeout 600 --push . -- <check>
  ```

  `--push` copies tracked and unignored files; inspect that set for private
  material first. `--no-env` withholds the account's stored secrets; it does not
  make uploaded files safe.
- **Multi-step work:** start with `boat new --no-env --json`, keep the `bx_...`
  ID from its `ready` event and pass that ID to every `boat exec`; `current` is
  terminal-local. Bound its auto-stop. Avoid `--keep`, public hosting and
  unlimited lifetimes unless the task requires them.

**Complete when:** each worker's command, size, timeout and ID are recorded.

## 4. Collect and delete

Keep each command's exit status and output as evidence; a failed check stays
failed. Return deliverables before deletion: push the branch, publish artifacts
or copy files back. Delete your worker, retain the deletion result and confirm
its ID is absent from `boat list --all --json` on every page
(`pageInfo.hasMore`); running-only inventory misses stopped and errored
sandboxes. Stop is not deletion. Reconcile an interrupted launch's ID before
retrying, and never delete another agent's sandbox.
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
