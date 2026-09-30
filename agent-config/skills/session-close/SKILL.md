---
name: session-close
description: "Close owned landing work and resource leases only when landed or explicitly parked with a resume note."
---

# Session close

Use the existing owner-scoped gate for both landing work and resource leases.
Sessions close only **landed** or explicitly **parked**. An exit 0 is not proof
of deployment, production correctness, ticket completion or a globally clean
host; those require the evidence below. Never inventory or delete other
sessions' resources to make this gate pass.

## Track at the start

Before editing, switching branches or deleting a worktree/branch, register every
repository you are responsible for, including an inherited worktree:

```sh
bun path/to/session-close.ts track
bun path/to/session-close.ts track --repo /absolute/path/to/worktree
```

`track [--repo PATH]` records the current repository, canonical checkout, branch,
HEAD and owner. Landing records live separately under the lease store's
`landings/`; they are not leases and survive removal of the original worktree.
`check` auto-tracks the current Git repository as a safety net, not a substitute
for recording before switching or deletion. Outside Git, `check` still checks
recorded work; with no recorded work or blocking owned leases it can pass.

## Create

In the same turn as creating a local worktree or a non-standing VM:

```sh
bun path/to/session-close.ts add --kind worktree --target /absolute/path
bun path/to/session-close.ts add --kind exe.dev --target vm.exe.xyz
```

`ws up --task T` records an `exe.dev-worktree` lease automatically. `ws init`
creates a standing owned project VM, not a session lease. Every lease records
`kind`, `target`, `owner` (`pid:<pid>:<starttime>`), `created`, and `expires`
(default 48 hours; `--expires-hours N` overrides it). `SESSION_CLOSE_OWNER`
overrides process ancestry for tests or non-agent callers. `--lease-dir` selects
a different store for isolated checks; live leases use
`~/.cache/tmp/omp-session-leases`.

## Land

Before calling the work done:

1. Merge the actual head through green required CI and the repository's model
   review gate. Review must cover the exact head; a new push requires fresh
   review.
2. Deploy the merged revision to the repository's actual targets and sanity
   check production behavior. For shared harness changes, install through both
   `pi-config/install` and `omp-config/install`: Pi's agent directory defaults
   to `~/.pi/agent`; OMP uses `omp config path` unless `PI_CODING_AGENT_DIR` is
   set. Shared launchers go to `~/.local/bin`; OMP also has declared scope and
   host targets. Respect component selection and foreign state. Restart the
   affected harnesses and observe the changed installed path; file presence or
   isolated installer tests do not prove production loading.
3. Inspect branch changes, untracked/ignored files and evidence. Delete the
   merged local and origin feature branch, remove only your finished worktree
   without `--force`, and leave the canonical checkout clean on the fetched
   origin default head. Do not remove standing VMs or another owner's work.
4. Update the PR and relevant existing ticket with status, context, deployed
   revision, review/CI and production sanity evidence. Follow tracker routing:
   Habitat for projects that use it; Misty Step/personal work remains on Linear.
   Do not create a ticket just to satisfy close or mandate Habitat elsewhere.
   Update affected docs; this harness's root Landmark release automation owns
   `CHANGELOG.md`, so do not manually edit it.

These review, deployment, production and ticket judgments remain doctrine, not
checker assertions. Report exact exercised evidence and any unverified path.

## Check before yielding

```sh
bun path/to/session-close.ts check
bun path/to/session-close.ts check --json
bun path/to/session-close.ts check --repo /absolute/path/to/canonical-checkout
bun path/to/session-close.ts leases --json
bun path/to/session-close.ts review
```

`check` evaluates every owned landing record, including records whose original
worktree has been removed, plus current checkout cleanliness/default branch.
It resolves the authoritative origin default using remote HEAD or GitHub
metadata, fetches that branch for fresh merge evidence and queries live origin
branch existence, not stale tracking refs. Landed status requires the canonical
default checkout clean and at that fetched head. For unparked landing work,
dirty current/owned/canonical checkouts, remaining local/origin feature branches,
an open branch PR or a retained owned linked worktree (including detached) block.
Parked records retain and report unfinished state rather than proving landing.

Direct merges/no-PR landings require the recorded HEAD to be an ancestor of the
fresh default head. Squash/rebase proof requires a merged PR whose head matches
the recorded HEAD and whose merge commit is an ancestor of the fresh default.
An old PR from a different branch lifetime is not proof. While the local branch
exists, its current HEAD refreshes the record so later commits cannot inherit
old proof. Worktree checks are scoped to recorded owned paths/branches, not
unrelated foreign worktrees.

`check` exits 2 for unresolved deterministic landing facts or blocking owned
live leases, 1 for corrupt storage or an unparked record's command/authentication
errors, unknown default or malformed API responses, and 0 only when owned work
is landed or explicitly parked and no other blocking owned leases remain.
Unparked GitHub failures fail closed; missing authentication is not no PR.

`leases` is read-only lease introspection for `ws` and other lease consumers:
no Git checks or auto-tracking. `leases --json` retains `leases`, `own`,
`foreign` and `needsReview`. Foreign landing records and leases are
informational, never mutated or deleted by the gate. `review` exits 3 while
expired, orphaned (process gone or starttime changed) or legacy ownerless leases
exist; review these manually, never delete their resources automatically.
Corrupt storage exits 1. Expiring a lease does not bypass owned landing records.

## Park unfinished work

```sh
bun path/to/session-close.ts park --repo /absolute/path/to/repo --note "Reason; owner; concrete resume steps"
bun path/to/session-close.ts unpark --repo /absolute/path/to/repo
```

Parking retains your repository's landing records and meaningful resume note.
`--repo` may name the canonical checkout or another extant checkout of the same
common Git repository, so parking/resuming still works after the original
worktree is removed. It affects only your records for that repository.
It allows unfinished close, preserves matching owned local worktree leases
and retained Git resources, and must be reported as **parked/unfinished** with
reason, owner, resume steps and current PR/ticket/resource status. It never
means done. Later auto-tracking does not silently unpark; use `unpark` to resume.
When all your existing records for a repository are parked, auto-enrollment of
its canonical default checkout preserves that state; new feature-branch work
is not automatically parked. Parked records permit retained checkout dirt and
canonical incompleteness; any unparked work in the same repository still
requires a clean canonical checkout. Parked records do not certify live
Git/GitHub facts; unavailable facts remain unverified under the resume note.
Parking does not waive live non-worktree leases: finish or deliberately resolve
those through the existing evidence/ownership procedure. Do not drop a lease
just to hide unfinished work.

## Remove owned resources

For each owned lease: inspect the branch, Git-visible changes, ignored files,
and other evidence before removal. `ws down` enforces an owner-bound lease and
refuses unpulled or changed remote evidence; run `ws pull --task T` first.
Remove a confirmed finished local worktree without `--force`, or remove a
non-standing VM only after confirming ownership and purpose. Keep uncertain or
externally owned resources. Once the resource is removed or a standing-ownership
decision is recorded:

```sh
bun path/to/session-close.ts drop --target /absolute/path-or-vm
```

`drop` prints the recorded owner; it can drop a stale lease after manual review.
Creates without leases remain invisible to lease introspection: fix create-time
recording rather than scanning or deleting other sessions' resources. Landing
records are independent; `drop` cannot certify that Git work has landed.
