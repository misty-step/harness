# Agent scratch routing: a run-scoped `TMPDIR`

Element **A3** of the 2026-09-15 workstation pressure report
(§3 A3, §4 B2, §6, §7). That historical report is not in this repository;
its old workspace-relative location is no longer available. The findings and
executed proof retained below are the available reference.
This is a **specification plus an executed proof of concept**, not a deployment:
it is the mechanism the report identifies as the single highest-value structural
change (§6: "route scratch to `~/.cache/tmp`"), and the one `pi-config` ADR-014
names as the condition that lets the host-resource prose in
`global/AGENTS.md` shrink to a pointer.

Nothing here is deployed. This document deliberately does not touch
`bin/tmp-health.py` (owned by the pressure monitor), `global/AGENTS.md` and
`skills/` (owned by policy), or `install` (owned by another workstream and
dirty). Those files' required changes are stated precisely in §6 so their owners
can act, and nothing else.

## 1. The finding

`/tmp` is a **46 GiB RAM tmpfs**. `~/.cache/tmp` is on the 3.7 TB root at 18%
used and is already watched by `tmp-health`. The problem is **routing**: every
byte an agent writes to `/tmp` competes with working memory and compresses into
zram (73.6 GiB resident at the incident peak), while a 3.0 TB-available disk
sits unused.

Measured on this host, 2026-09-15 (light, user-scope commands only):

| Location | Entries | Bytes | Notes |
| --- | ---: | ---: | --- |
| `/tmp` | 906 | 22 GiB per `df` (46%), 18.4 GiB walked by `du` | 46 GiB **RAM** tmpfs; the gap is root-owned entries (`systemd-private-*`, SDDM auth) the user walk skipped |
| `~/.cache/tmp` | 71 | 6.4 MiB | disk, monitored; **71 foreign entries** from Chromium, jiti, `node-compile-cache`, `omp-python-runner`, `omp-shell-snapshots-*`, `hermes-dm-*`; no `runs/` and no cleanup mechanism |

Largest `/tmp` consumers (MB, `du -sm /tmp/*`):

```
5126 /tmp/ha-347-live-p4dm6hoe          1050 /tmp/olympus-host-recovery-production
2145 /tmp/tach-qa-1000                  1049 /tmp/olympus-production-release
1489 /tmp/tapeback                       808 /tmp/olympus-agent-workflow-permissions-proof
1050 /tmp/olympus-permission-diagnostic-production
 660 /tmp/olympus-host-idle-diagnostic-proof   480 /tmp/olympus-argus-admins-reimage-proof
 393 /tmp/bunx-1000-supabase@2.104.0      368 /tmp/bunx-1000-vercel@latest   181 /tmp/gocache-root
```

Note that the top entry is a **single live run**
(`ha-347-live-p4dm6hoe`, 5.1 GiB) — not historical debris. Aging (`/etc/tmpfiles.d`,
workstream A2) cannot fix a live run; only routing can.

## 2. Inventory: how scratch is created

Callers that go through the environment (fixed by one setting):

| Mechanism | Occurrences in `~/development` | Follows `TMPDIR`? |
| --- | ---: | --- |
| `os.tmpdir()`, `mkdtemp`/`mkstemp`, explicit `TMPDIR` (JS/TS/Python/Go/Rust) | 944 files (~841 first-party; 103 vendored in `tapeback/.venv`) | **yes** |
| Python `tempfile.mkdtemp()` | — | **yes** (read at call time) |
| GNU coreutils `mktemp -d` | — | **yes** (verified: `TMPDIR=… mktemp -d` → `$TMPDIR/tmp.zJ59TipGso`) |
| Shell `$$`-named dirs under `/tmp` (e.g. `~/.cache/tmp/run-$PPID-$$` pattern in the report) | script-owned | **yes** |

Per-repo concentration of the environment-honouring class (top, files):
`sploot` 231, `linejam` 31, `iron-forest` 31, `cyoa-video` 25, `praetor` 22,
**`time-tracker` 18**, `habitat` 17.

Callers that **do not** follow the environment (residual class after routing):

| Mechanism | Occurrences | Note |
| --- | ---: | --- |
| Hardcoded `"/tmp/…"` string literals | 66 files in `sploot`, 10 in `time-tracker`, 7 each in `linejam`/`linejam-verify-20260909`, 5 each in `infrastructure`/`omarchy-stabilization/test`, 4 each in `olympus`/`canopy`/`canopy-design-catalogue` | needs path indirection per repo; **not** fixed by `TMPDIR` |

The caller behind the reported leak is entirely in the first class, which is why
one setting covers it:

- `r90group/time-tracker/test/setup-verification.ts:13` builds its root as
  `path.join(os.tmpdir(), "time-tracker-verify-<pid>-<pool>-<uuid>")` and removes
  it in `afterAll` (line 24).
- Four sibling call sites use `fs.mkdtempSync(path.join(os.tmpdir(), …))`
  (`app-diagnostics`, `harness-validate`, `verification-isolation`,
  `timer-status`).

`afterAll` cannot run when a worker is killed or the run is aborted, so the
artifacts outlive the run: **72 `/tmp/time-tracker-verify-*` directories, all
empty, all verified non-empty count 0** — one 15:37 vitest run. This is the
report's proof that cleanup cannot be a worker responsibility.

### The bridge that already exists (and why it is not the fix)

`~/.bashrc` (line 5, above the non-interactive `return`) and `~/.profile` (line 8)
already carry:

```sh
export TMPDIR="$HOME/.cache/tmp"
```

Observed live: this agent session runs with `TMPDIR=/home/phaedrus/.cache/tmp`,
and `systemctl --user show-environment` carries the same value. This is the
right **locus** with the wrong **object**:

- it is **not run-scoped**: every session, job and tool on the host shares one
  directory, so nothing can be removed when a run ends;
- it has **no lifecycle**: no creator, no remover, no sweep. It moves the
  unbounded-growth problem from a RAM tmpfs to the disk (6.4 MiB today, nothing
  bounding it);
- it is **unowned**: a hand-edit in two dotfiles in no repository, undeployed,
  unverified, and exactly the drift class the report's §A7 warns about;
- it is **a stale-value hazard** for unit launches (see §3).

## 3. Where `TMPDIR` belongs

**Rule: `TMPDIR` propagates by inheritance, so it must be set at the highest
ancestor that is guaranteed to be in the lineage of every scratch writer — the
agent session root — and nowhere else.**

**Recommended placement point: a session-root wrapper (`omp-scratch exec -- <agent>`)
hung off the existing launch injection point — the `pi` shell function in
`~/.bashrc`, plus the equivalent for `omp`.**

Why there:

- **It reaches what the session launches, without their cooperation.** Inheritance
  happens at `fork`; it is independent of cgroups, of reparenting to
  `systemd --user`, and of whether the parent shell is gone. Detached children,
  forked worker fleets and nested subagents all get it. (The report's §A4 note —
  "wrapping a client does not contain what it launches" — is about *cgroup
  placement*. For an *environment variable* the opposite holds, and that
  asymmetry is the whole argument for routing here and bounding there.)
- **One setting for all 63 repositories and both harnesses**, versus 63 prose
  edits (report §B3).
- **The injection point already exists and is proven.** `pi` is launched through
  a shell function in `~/.bashrc` today (that is where `pass-env` is injected for
  the Exa key), so this adds no new launch layer.

Rejected candidates:

| Candidate | Verdict |
| --- | --- |
| `omp`/`omx` command | `~/.local/bin/omp` is a 250 MB compiled binary, not a script; shimming it fights upstream updates, and it covers exactly the same process set as the session wrapper because `omp` is started from the session. |
| `devrun` admission shim (§A4) | Covers only jobs routed through it, and does not exist yet. Routing must not depend on admission landing. `devrun` must instead **compose** with this (below), because systemd boundaries drop the caller's environment. |
| Agent session environment *only* (the `~/.bashrc`/`~/.profile` export) | Correct locus, wrong object: a shared directory with no lifecycle (§2). Replace the object, keep the locus. |
| Per-repo config / per-repo `AGENTS.md` | 63 files, drifts, and cannot survive a killed worker (report §B2, §B3, §6). |

### Inheritance escape hatches, measured

| Launch path | Gets session `TMPDIR`? | Evidence | Requirement |
| --- | --- | --- | --- |
| Agent tool subprocess, forked/reparented children, worker fleets | **yes** | this session; PoC acts 1–4 | — |
| `systemd-run --user --scope` | **yes** (caller's env) | with `env -u TMPDIR` the scope saw empty; with it set, the scope saw `~/.cache/tmp` | `devrun` should still pass `--setenv=TMPDIR="$TMPDIR"` to be explicit |
| `systemd-run --user` (service — the pattern `references/dev-exec.md` recommends for non-interactive jobs) | **no** — it gets the **user manager's login-time value** | with the caller's `TMPDIR` stripped, the service still saw `~/.cache/tmp` | must pass `--setenv=TMPDIR=…`. **Never rely on the manager value**: under this design it is a stale run id |
| Containers (`docker run`) | **no** (Docker does not forward host env) | documented behaviour; Docker is present | `-e TMPDIR=/scratch` plus a bind or tmpfs, owned by the container wrapper |
| `ssh <remote>` | **no** (`TMPDIR` is not in the default `AcceptEnv`; no `SendEnv` is configured here) | config inspection | the remote host needs its own session rule |
| `sudo`/`pkexec` | **no** (`env_reset`) | documented | not on the agent-scratch path |

**Failure-closed note.** A run-scoped `TMPDIR` that has been swept points at a
directory that no longer exists, and `mkdtemp` then fails with `ENOENT` rather
than silently using `/tmp`. That is the right failure (loud, not memory-eating),
but it must not fire for live work. Two requirements prevent it, both proven in
the PoC: the session root **holds the lock for its whole life**, and the sweep
**never reaps a locked run**. A `systemd-run --user` service started mid-session
therefore sees a live directory.

## 4. Lifecycle specification

**Layout**

```
~/.cache/tmp/runs/<run-id>/          # run-id = <UTC yyyymmddThhmmssZ>-<owner-pid>-<label>, mode 0700
  .owner.lock                        # flock target; held by the owner only
  owner.json                         # {run, owner_pid, started, command?, cwd?, repo?}
  <scratch created by callers>       # mkdtemp children, verify roots, evidence
```

Nested under `runs/` because `~/.cache/tmp` is shared with 71 foreign entries
(Chromium, jiti, `node-compile-cache`, `omp-python-runner`, …). The sweep must be
able to say "every child of `runs/` is mine" — a flat layout cannot, which is the
one thing the report's `~/.cache/tmp/run-$PPID-$$` example gets wrong.

**Environment exported to the agent and everything under it**

```sh
TMPDIR="$run"  TMP="$run"  TEMP="$run"  OMP_SCRATCH_RUN="<run-id>"
```

**Who creates it.** The session-root wrapper — a single process, before it execs
the agent. Nothing else creates run dirs.

**Who removes it, and why it cannot depend on the worker**

| Event | Remover | Mechanism |
| --- | --- | --- |
| Normal exit | owner trap (`EXIT`) | `rm -rf` of the whole run dir |
| Ctrl-C / `SIGINT` / `SIGTERM` / `SIGHUP` | owner trap | same, on `INT TERM HUP` |
| Worker SIGKILLed, aborted run | owner trap | the owner is still alive; `wait` returns 137 and the trap fires — **the killed worker's cooperation is not needed** |
| Owner SIGKILLed, host crash, power loss | `omp-scratch gc` sweep | the kernel drops the flock when the last holder dies, so an unlocked run dir with age > grace is reaped |
| Nothing matches | — | never reaped |

**Cleanup is directory-scoped.** Removing the run dir removes every leaked
`mkdtemp` child inside it, in one operation, without enumerating artifacts. This
is the pokayoke for "72 directories `afterAll` was supposed to delete": the
harness removes the container, so no worker's cleanup path is load-bearing.

**Liveness is a lock, not a PID.** The owner holds an exclusive `flock` on
`.owner.lock` for its whole lifetime, on a file descriptor its children do **not**
inherit (`9>&-`). The kernel releases the lock when the last process holding the
descriptor dies — including `SIGKILL`. There is no PID bookkeeping, no `/proc`
scan, and no PID-reuse hazard.

**Sweep rule.** Reap a run iff `flock` is acquirable **and** the run dir's mtime
age exceeds the grace (default **900 s**). Order the checks **age first, then
liveness**, and never create a missing lock file during the check: creating one
would touch the run dir's mtime and perpetually refresh its own age. Run the
sweep opportunistically at every run creation (bounded, cheap) and from a timer.

**Hard invariants for the implementation**

1. Never `rm -rf` the run root or anything outside `$XDG_CACHE_HOME/tmp/runs/*`.
   Guard with a prefix check; refuse and report on mismatch (in the PoC).
2. Never reap a locked run, regardless of age or grace.
3. Never touch siblings of `runs/` — that directory contains 71 foreign entries.
4. The session root holds the lock until the session ends; the run dir outlives
   every subordinate command.
5. Run dirs are deleted, so anything worth keeping must be moved out before exit.

## 5. Proof of concept — executed

`references/scratch-routing-poc.sh` implements the owner and sweep as described
and demonstrates the lifecycle. Run as:

```sh
env -u TMPDIR ./references/scratch-routing-poc.sh
```

It is tiny and bounded: everything happens under `~/.cache/tmp/runs`, `/tmp` is
never written, and the run dirs and evidence are removed at the end. Verbatim
output of the recorded run (one invocation, 2026-09-15):

```
== act 1 — run-scoped TMPDIR is honoured by mkdtemp(os.tmpdir()), and the run dir is removed on exit ==
ok:   node mkdtemp inside run dir: /home/phaedrus/.cache/tmp/runs/20260915T211521Z-2111774-ok/poc-node-qv6o8E
ok:   python mkdtemp inside run dir: /home/phaedrus/.cache/tmp/runs/20260915T211521Z-2111774-ok/poc-py-xjv34br2
ok:   run dir removed by the owner trap on normal exit (/home/phaedrus/.cache/tmp/runs/20260915T211521Z-2111774-ok)

== act 2 — worker SIGKILL: the owner's trap still removes the run dir ==
ok:   worker 2111823 SIGKILLed; owner exit status 137 (137=SIGKILL propagated)
ok:   run dir removed by the owner trap after the worker was SIGKILLed (/home/phaedrus/.cache/tmp/runs/20260915T211521Z-2111806-killed-worker)

== act 3 — owner SIGKILL: no trap can run, so the liveness-keyed sweep reclaims it ==
ok:   owner 2111836 SIGKILLed; trap could not run, run dir remains: /home/phaedrus/.cache/tmp/runs/20260915T211521Z-2111836-dead-owner
--- sweep with grace 0 ---
    gc: reap  (age 0s, unlocked) 20260915T211521Z-2111836-dead-owner
    gc: reaped=1 kept=0
ok:   sweep reclaimed the run dir after the owner was SIGKILLed

== act 4 — a live run is never reaped, even with grace 0 ==
    gc: keep  (live)            20260915T211521Z-2111863-live
    gc: reaped=0 kept=1
ok:   live run protected by its lock, not by age: /home/phaedrus/.cache/tmp/runs/20260915T211521Z-2111863-live

== act 5 — /tmp was not written ==
ok:   /tmp entry count unchanged (909)
ok:   no poc-* entries in /tmp
ok:   evidence removed; runs/ left empty

ALL ACTS PASSED
```

What each act establishes:

| Act | Claim proven |
| --- | --- |
| 1 | A `mkdtemp(os.tmpdir())` caller in **two runtimes** (Node and Python) lands inside the run dir, and the run dir is gone after a normal exit — the `time-tracker` caller is fixed and cleaned without editing the repo. |
| 2 | A worker killed with `SIGKILL` does not prevent cleanup: the orchestrating owner, not the worker, removes the directory. This is the 72-directory failure, closed. |
| 3 | When the owner itself is `SIGKILL`ed, no trap can run and the directory survives — then the `flock`-keyed sweep reclaims it. Cleanup does not depend on any worker's, or the owner's, cooperation. |
| 4 | With grace 0, a **live** run was still kept: liveness (the lock) is the gate, not age. The sweep cannot race a running job. |
| 5 | `/tmp` entry count unchanged across the whole demonstration, no `poc-*` entries in `/tmp`, `runs/` left empty, no stray processes, `~/.cache/tmp` still 6.4 MiB. |

## 6. What has to change to deploy this (not done here, owner by owner)

1. **`omp-config` (this repo).** Add `bin/omp-scratch` — the PoC's `owner` and
   `gc` modes with `exec`/`gc`/`env` subcommands — and an `install` stanza
   installing it `-m 700` to `~/.local/bin/omp-scratch`, alongside the existing
   `omp-grievances`/`pass-env` stanzas. `install` is owned by another workstream
   and currently dirty, so this document does not touch it; the change is one
   `require_nonempty` + `install` pair in the shape already used for
   `bin/omp-grievances.ts`.
2. **Host launcher dotfiles (unowned by this repo).** Replace the bridge export
   in `~/.bashrc`/`~/.profile` with the run-scoped object, e.g.
   `pi() { command omp-scratch exec -- command pass-env run … -- pi "$@"; }`, and
   the same for `omp`. Keep a plain `TMPDIR="$HOME/.cache/tmp"` fallback for
   non-agent shells.
3. **Sweep scheduling.** Opportunistic at run creation, plus one of: an
   `omp-scratch-gc.timer` user timer, or a piggyback on `tmp-health`. If the
   monitor prefers to own it, what it needs is a **run count and oldest-run
   age** under `~/.cache/tmp/runs` — not a new filesystem check. Do not fold it
   into `tmp-health` without the monitor's decision.
4. **`policy` (`omp-config/global/AGENTS.md`, `skills/`, `pi-config/global/AGENTS.md`).**
   Nothing is needed today; the prose rule is already correct. Once routing is
   deployed, per ADR-014 the five-rule section can shrink to a pointer at the
   mechanism, and `references/dev-exec.md` should gain the `--setenv=TMPDIR=…`
   requirement for its `systemd-run --user` service examples. This document does
   not edit those files.
5. **`devrun` (§A4, separate owner).** Must compose: pass
   `--setenv=TMPDIR="$TMPDIR"` on `--scope` and `-p Setenv=TMPDIR="$TMPDIR"` on
   unit launches, and give containers an explicit mount plus `-e TMPDIR=…`.
   Admission and routing are independent; neither subsumes the other.
6. **Per-repo (Workstream C).** Hardcoded `"/tmp/…"` literals — 66 files in
   `sploot`, 10 in `time-tracker`, and so on — are the residual class this
   routing does **not** reach. They need path indirection at the call site.

## 7. Verification

Anywhere, cheap and local:

```sh
env -u TMPDIR ./references/scratch-routing-poc.sh          # all five acts pass
bash -n references/scratch-routing-poc.sh
```

Once deployed, the acceptance criteria from the report's §8 apply:

- a full `vitest` run in `r90group/time-tracker` leaves **zero** new
  `/tmp/time-tracker-verify-*` entries, and a populated-then-removed
  `~/.cache/tmp/runs/*`;
- `kill -9` the owner, then one sweep reaps its run dir;
- `ls -1 ~/.cache/tmp/runs | wc -l` stays bounded (and `~/.cache/tmp` keeps its
  71 foreign entries untouched);
- `tmp-health` records no `>80%` latch during a run.

## 8. Open decisions for the operator

1. **Run granularity.** One run dir per agent **session** (recommended: matches
   the lock lifetime, removes the stale-`TMPDIR` hazard, and one owner trap
   covers a whole session) versus one per heavy **command** (tighter, but then
   `devrun` must own creation and cleanup).
2. **Grace default.** 900 s is proposed. Should there also be a max-age backstop
   (e.g. 24 h) for a daemonised child that keeps the lock forever?
3. **Evidence retention.** Run dirs are deleted; anything to keep must be moved
   out first. Do we want a promoted `~/.cache/evidence/<run-id>/` path with its
   own retention, per report §B2 ("evidence is bounded … with retention")?
4. **The human fallback.** Keep `TMPDIR="$HOME/.cache/tmp"` for non-agent
   interactive shells (recommended), while agent sessions get the run-scoped
   directory?
5. **Sweep ownership.** `omp-scratch-gc.timer` versus a `tmp-health` piggyback —
   the monitor owns that answer.
6. **`/tmp` size.** Unchanged by this document; the report defers the 46 GiB →
   ~24 GiB resize to the operator (§9.2).

Existing `/tmp/time-tracker-verify-*` debris (72 empty directories) is left to
workstream A2's `tmpfiles.d` aging; this document neither creates nor removes it.