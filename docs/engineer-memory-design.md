# Engineer memory: isolate work, own death

**Design only — 2026-10-07 CDT.** Branch: `phaedrus/engineer-memory-cap`.
No implementation, deployment, running-scope changes, push or PR. Covers
**K-20261007-a-dead-engineer-never-shows-as-working**: a dead engineer must
show **lost within one heartbeat**, including the Trellis and Time Tracker
UI designers R90 reported as working for an hour after their deaths.

## Evidence: what died and what held memory

All seven kernel records say `CONSTRAINT_MEMCG` and name an engineer leaf;
these were **leaf-limit OOMs**, not global OOMs. Each dump reports usage and
limit `4194304kB`, zero swap; systemd records `oom-kill` and a 4G peak.
Those peaks are censored: they cannot tell us the unconstrained peak or justify
a replacement cap. A larger cap might have avoided some deaths; it would not
remove their shared failure domain. [J, U]

Times below are local CDT. Units are `omp-engineer-<suffix>.scope`. Charged
memory is MiB; victim anonymous RSS is KiB. Kernel statistics are approximate
snapshots. **Shmem is included in file**, not an additional charge.

| Kill | Scope suffix | Charged anon | Charged file / shmem | Charged kernel | Initial victim; anonymous RSS | Native-session reconstruction |
|---|---|---:|---:|---:|---|---|
| 10:34:57 | `eb4ea1a53330ea2dc25daffb` | 3757.3 | 184.8 / 184.2 | 153.7 | OMP 2662644; 1,845,136 | Outreach: 16 unyielded logical workers; nested fanout immediately before death. [J:40–52,156–157; F] |
| 11:54:42 | `e62afc1e2063d653edcfcef2` | 3832.3 | 177.0 / 176.8 | 86.3 | OMP 3866918; 1,749,284 | Resumed outreach: 20 workers started, 18 unyielded; unresolved lead wait. [J:229–241,363–364; F] |
| 12:21:24 | `c68181db8c22b65d30feda38` | 3667.8 | 297.7 / 297.6 | 130.5 | OMP 2664015; 1,238,548 | Family: eight-way, 60-fps film rendering began about five seconds earlier. Earlier site designers had disposed. [J:462–474,593–594; F] |
| 12:52:13 | `9f81174823f13ee94ba421c3` | 3792.4 | 240.8 / 240.4 | 62.8 | OMP 3735856; 3,173,884 | Wiki: latest lead prompt 115,494 tokens; five unfinished second-wave/audit workers. Large lead address space, not proof of a large lead-only context. [J:691–703,819–820; F] |
| 16:36:51 | `8f6f7d5698f7b45cd0f54abc` | 3876.4 | 131.7 / 131.6 | 87.9 | OMP 2881515; 1,549,972 | Iron Forest: eight unfinished designers, latest prompt 740,043 tokens. Saved compaction completed later, not before this kill. [J:904–916,1026–1027; F] |
| 17:47:30 | `8f1338075f09108e793867a3` | 3893.2 | 142.2 / 136.0 | 60.5 | OMP 4166252; 1,447,480 | Trellis candidate: concurrent embedding and Whisper jobs; Python processes held 1,309,816 and 287,204 KiB anon. R90 reports both UI designers affected at 17:47. [J:1114–1126,1191–1228; F; Kaylee report] |
| 17:56:19 | `a891e51ec6ee81756923953f` | 3912.0 | 129.1 / 129.1 | 54.9 | Chromium 513864; 2,075,668 | Time Tracker candidate: accumulated tab openings and a dangling browser interaction. Group kill also took OMP 4163267, 1,123,936 KiB anon. [J:1304–1316,1410–1417; F] |

**Identity limit:** scope/victim joins are firm. Session associations combine
launch-time bounds, native activity and recovery messages, but no historical
PID-to-session key was recovered. R90's 17:47 attribution is user evidence;
the Time Tracker transcript continues through 17:56, so its precise scope/time
join remains unresolved, not silently rewritten. Each candidate transcript has
a started tool/wait without a committed result. [F]

The killed leaves were anon-dominated; nearly all their file charges were
shmem. Do not infer this from every 4G peak:

| Live observation | Measured ownership | Evidence |
|---|---|---|
| Own lead, three in-process agents active, 23:46:22Z | Lead anon 686.2 MiB; PSS 703.3 MiB. Scope current 3.891 GiB, including 2.445 GiB file and 696.6 MiB reclaimable slab; OOM counters zero. | `engineer-browser-before.json` |
| Controlled headless `about:blank`, 23:46:35Z | 13 browser/crashpad processes: aggregate PSS 292.35 MiB; broker PSS 87.16 MiB. Lead growth is confounded by concurrent agents. | `engineer-browser-opened.json` |
| Idle JS eval worker PID 1628, 00:20:17Z next UTC day | Actual argv `__omp_worker_js_eval_process`, parent lead PID 2; anon 156,024 KiB, RSS 223,684 KiB. | `engineer-js-kernel-probe.json` |
| Cage processes at first OOM | Two bwrap processes: anon 140/292 KiB; slirp: 35,988 KiB. Not dominant in that snapshot. | J:160–162 |

Browser RSS sums overcount shared mappings; PSS is used above. Kernel task
tables contain unique TGIDs, whereas group-kill messages also name threads:
never sum their victim RSS. Auxiliary historical OMP processes resemble the
measured JS worker **[INFERENCE]**; their historical argv/ownership was not
recovered. Logical subagents are not those processes. [J, N]

Native OMP 18.7.0 constructs subagent `AgentSession`s **inside the lead**.
Finished sessions normally remain warm for seven minutes, retaining journals,
kernels and tabs until disposal. The journal includes tool results and images;
compaction rebuilds display history, not a demonstrated RSS bound. The Iron
Forest 740,100-token compaction record completed at 23:37:26Z, after its
21:36:51Z OOM; there is no saved start record proving whether speculative work
was active at death. **No post-GC heap-retainer profile exists.** Anonymous RSS
cannot distinguish JS objects, image/buffer copies, allocator retention or
native allocations. We have not proved a leak or compaction trigger. [N, F]

## Desktop budget: the current cap is not a fleet guarantee

At 23:43:54Z there were 26 measured leaves: sum current **38.209 GiB**, anon
**25.044 GiB**, file **11.590 GiB**, kernel **1.547 GiB**. Their individual,
non-simultaneous peaks sum to 82.908 GiB; that is not a fleet peak.
Physical RAM was **91.958 GiB**. The theoretical leaf ceilings already total
**104 GiB**, exceeding RAM minus the 20 GiB floor. `omp.slice` is unlimited;
the floor and 36 GiB fleet guide are explicitly advisory. [L, P]

At 23:53:07Z, `MemAvailable` was **27.021 GiB**, only **7.021 GiB** above the
floor; `dev-exec.slice` held **5.932 GiB** against a **16 GiB** ceiling, allowing
**10.068 GiB** more. It could consume the margin without any engineer growth.
The floor owner must include heavy jobs, uncaged/legacy agents and non-agent
burst demand, not just count launches. [B]

**Recommend one hard non-desktop-work budget, with measured burst headroom,
plus admission/backpressure against the floor.** This is an explicit policy
change from advisory, requiring Phaedrus's approval before deployment. Its
ceiling must fit measured non-agent peak demand, the floor and burst allowance;
no new number is defensible from capped peaks. Do not compute a ceiling as
`fleet.current + MemAvailable - 20`: available memory already includes
reclaimable fleet cache. `memory.high` throttles/reclaims but can be exceeded;
it cannot enforce the floor. A non-desktop ceiling also cannot guarantee
20 GiB available against unbounded unrelated desktop demand. State that
conditional guarantee, rather than promising one. [B, P, K]

## Options and selection

An independent **Opus/high** investigation preceded selection. Its initial
preference was group-OOM off plus helper-first kill priorities. After review,
it agreed that priority is not ownership and recommended isolating existing
OS helpers. The full opinion and qualifications are preserved in evidence. [O]

| Design | Benefit | Decisive tradeoff |
|---|---|---|
| Bound everything in one shared runtime | Least IPC; one native admission/retention owner can bound fanout and cold state. | Browser/Python spikes remain in the lead's kill domain. |
| Ungrouped leaf, helper-first OOM scores | Small cutover; kernel may sacrifice helpers first. | Not a guarantee: renderer score changes, repeated OOMs and in-process allocations can still select the lead. Reject as durable architecture. |
| **Isolate existing OS helpers; bound the shared lead** | Actual failure boundaries, without one new process per logical agent. Retains group kill where partial survival is unsafe. | Requires native spawn placement and working-set ownership; aggregate exhaustion remains a separate failure. **Select.** |
| Process/cgroup per logical agent | Individual agent failure and recovery. | More resident runtimes and IPC; actual agent-process baseline needs measurement. Reconsider only if shared-runtime profiling defeats a bounded design. |
| One pooled cap, remove individual boundaries | Deletes arbitrary engineer cliffs and most shape checks. | A pooled OOM can select another engineer's lead; no isolation or fairness. Aggregate budget alone is insufficient. |

### Selected architecture and limit behavior

- The **lead/in-process agent family** has its own bound. Broker+Chromium,
  each eval kernel, and each command tree are separate, already-existing OS
  workloads with their own bounded, coherent failure domains. Use group-OOM
  **inside** such a tree, never around unrelated model and tool siblings.
- The engineer accounting parent is ungrouped with `OOMPolicy=continue`.
  Its effective ceiling must not bind below the sum of admitted child bounds
  and infrastructure charges; otherwise it recreates the shared kill domain.
  Helper-pool exhaustion may kill a tool tree, not select a lead sibling.
  Spawn into the target group **before substantial allocation**; migrating a
  running process does not transfer its existing memory charges. [K]
- Keep in-process agents. Reuse the native admission owner across the entire
  spawn tree; don't multiply independent per-session permits. Bound retained
  histories/large assets using the existing JSONL/artifact authority and a
  paged working set. Park completed agents promptly and release run-owned
  kernels/tabs; cold revival must explicitly report lost ephemeral kernel
  state. Preserve persistence within an active run. Heap profiling chooses
  the first native retention fix, not a speculative leak theory. [N]
- **Before the limit:** stop new work, park cold state, release owned resources,
  and defer portable heavy work to the already approved execution path.
  `memory.high` is a useful early signal only when work can actually yield;
  indefinitely throttling an unreclaimable heap just produces a hung engineer.
- **At a tool hard limit:** kill that coherent tool tree; return an explicit
  interrupted/unknown-result error. Other tool trees and model contexts remain.
  **At a lead limit:** that lead attempt may die; host marks the generation lost
  and offers exact-session recovery. **At aggregate exhaustion:** the desktop
  backstop wins; a worker can still be lost, loudly, not the entire fleet.
- Reuse the launch authority and native resource owners; no new scheduler,
  broker, memory ledger or periodic kill-priority fixer. Delete the all-peer
  exact-4GiB/group-OOM verification loop: verify the newly launched role's actual
  effective controls and placement, not every other engineer's identical
  shape. This avoids the observed fleet-wide refusal after two live overrides.
  Existing scopes remain untouched; new roles appear only on natural launches.

Placement/delegation, systemd's handling of descendant OOMs, cross-cgroup
namespace teardown, shared-browser ownership, and persistent shmem charges
need disposable real-path proofs before cutover. A dead label is not freed
memory: keep charges accounted until the resource tree actually drains.

## Death must be owned outside the failed process

Herdr reports version 0.9.1. That version's identified-agent loop sleeps 300 ms,
but its actual process probes have longer gates and can be skipped indefinitely
under unchanged foreground-group/full-hook authority. Installed OMP hooks are
transition-driven, not liveness heartbeats. No explicit `lost` status exists.
This is a concrete source-level gap consistent with the reported stale state,
not proof of which path froze either pane. Terminal synchronized-output state
is another possible presentation mechanism **[INFERENCE]**. [H, D]

**Required contract for K-20261007:** register `(pane generation, exact native
session, host root PID + start token/pidfd, scope invocation)` from the trusted
launch handoff. The root is the native lead, not its surviving wrapper, a hook
CLI child, foreground PGID or any helper. The bridge's authenticated peer PID
alone identifies the CLI child, not the lead. [D]

Herdr must check that incarnation independently of hook/screen activity and
publish a retained **lost tombstone by the next host heartbeat H**. The native
300-ms identified tick is a candidate cadence, not a demonstrated death SLA.
Document H and exercise it. Preserve the exact session reference when clearing
active ownership; mark co-resident active agents lost too. A fresh incarnation
of the same session rejects old exits/reports. A live lead in a long tool or
provider call is not lost merely because it emits no hooks.

The pane and roster must stop asserting working even if the PTY, wrapper,
helpers or final frame remain. Kaylee must consume lost as a wake event,
including uncommissioned engineers, rather than wait for a quiet model turn.
Its existing 10-second poll is a separate
heartbeat: use the native event path to invalidate cached working promptly,
and verify the end-to-end deadline rather than adding two polling delays.
Five-minute outcome delivery is **not** this liveness deadline. [D]

OOM cause comes from kernel/systemd evidence, not exit 137. The outside wrapper
can accelerate reporting but cannot be the only detector. `--collect` removes
failed units; durable journal fields still identify `USER_UNIT`,
`USER_INVOCATION_ID` and `UNIT_RESULT=oom-kill`. The existing host reporter
intentionally suppresses transient-user-unit noise, so don't delete that
classification or assume attaching its failure hook solves this. [U, P, D]

Recovery opens the **exact saved JSONL**, never whichever session is newest.
The interrupted tool starts in today's transcripts have unknown outcomes.
SIGKILL cannot write its own exit record; current native interrupted-result
synthesis depends on such evidence, and context rebuilding can strip dangling
calls. Persist an explicit interruption/unknown-result boundary through the
native session owner. Reconcile external state before retrying; no automatic
side-effect replay, allocator replay, followup resend or restart loop. [F, N, D]

## First small PR and rollout

**First PR: every verified engineer OOM enters the existing outcome route.**
Add a narrow engineer-OOM journal adapter to the **existing hermes-config
host-alert sweep**. Use its `run_record/append` spool API with the systemd
invocation as a stable run identity; spool before checkpointing. Retain unit,
cause, time and known recovery identity, without inventing missing session
joins. A later surviving-launcher fast path must produce the same identity,
not another random-UUID CLI record. Keep transient experiment suppression.
No new service, watcher, ledger, cap or running-scope mutation. [D, A]

First-PR acceptance: a real scratch-engineer OOM reaches Kaylee after unit
collection, including when the wrapper cannot report; rereading the journal
produces no duplicate run, a second kill remains a distinct recorded event,
and intentional non-OOM transient failures stay suppressed. Existing cause
coalescing can create one incident while retaining every death event.

**That PR does not close K-20261007.** Next land Herdr's root-incarnation/lost
contract, the harness's authenticated identity handoff, and Kaylee's lost
projection. Kill a scratch lead with a surviving helper, quiet/frozen frame and
long pending tool: pane, native read API and Kaylee must show lost within H;
a healthy long call must not. Prove exact-session recovery and that a stale
old-generation exit cannot kill the resumed generation's status. These are
cross-repository dependencies, not a launcher-only patch.

Then profile native ownership, isolate existing tool trees, bound lead working
sets, and commission the approved aggregate budget. Only after those proofs
select numerical role limits from **uncensored** representative workloads and
measured concurrent bursts. Roll out on natural relaunches, never by modifying
running engineers. No code or deployment is authorized by this document.

## Evidence references and verification boundary

Private investigation evidence directory **E**:
`~/.omp/agent/sessions/-.herdr-worktrees-harness-phaedrus-engineer-memory-cap/2026-10-07T23-35-08-877Z_01a118b8-874d-7197-847b-ebb2d9a9a0fd/local/`.
Live-table filenames are under E; measurements are UTC. Detailed reports retain
the native transcript paths and exact line/call identities, not just timing.

- **J:** E/`engineer-seven-kernel-unfiltered.log`, cited line ranges above;
  E/`engineer-seven-kernel-measurements.json`. Retrieved with
  `journalctl -k --since '<kill minus 3s>' --until '<kill plus 3s>' --no-pager -o short-iso`.
- **U:** user journal on 2026-10-07: Failed/Consumed engineer records; first
  invocation `47308794079f4dd18de02dca68d018c7`. JSON fields were retrieved with
  `journalctl --user --since '2026-10-07 10:34:50' --until '2026-10-07 10:35:10' --grep 'omp-engineer-eb4ea1a53330ea2dc25daffb' -o json`.
- **F:** E/`kill-session-forensics.md` and `kill-kernel-forensics-supplement.md`.
  Root-session aliases O/F/W/I/T/U there cite respectively outreach
  `:182,237–239,248,287–289`, family IdeasFilms `:453–454`, wiki `:231,235–237`,
  Iron Forest `:780,824,834–837`, Trellis `:599–601` and MediaMaker `:504–505`,
  Time Tracker `:718–720`. The original report's missing-kernel-table caveat
  is superseded by the unfiltered supplement; missing session joins are not.
- **L/B:** E/`engineer-live-cgroup-sample.json` (23:43:54Z) and
  `engineer-host-budget-probe.json` (23:53:07Z), from cgroupfs and `/proc/meminfo`.
- **N:** official [OMP v18.7.0](https://github.com/can1357/oh-my-pi/tree/v18.7.0):
  `task/executor.ts:4366–4398`; `task/settings.ts` idle TTL;
  `session/agent-session.ts:5429,5576,5678`;
  `session/session-manager.ts:2807–2840`;
  `session/session-maintenance.ts:2409–2444`;
  `eval/js/context-manager.ts:125`;
  `session/exit-diagnostics.ts:102–128,170–199`;
  `session/session-context.ts:671–699`. Installed binary SHA-256
  `03387aceae62386eaefbe96786f6df0e2e2e843ce76926c063a485905b1f4c4f`
  matches the [official Linux-x64 release asset](https://api.github.com/repos/can1357/oh-my-pi/releases/tags/v18.7.0).
- **H:** pinned [Herdr 0.9.1, 065ef9d6](https://github.com/herdrdev/herdr/blob/065ef9d6a531c49fb8bee7e818ef837065b21ee9/src/pane.rs):
  `:312–320,470–531,2460–2462,2597–2600`; matching `detect/mod.rs:11–20`,
  `terminal/state.rs:490–512,1812–1817,1871–1880`. The newer master PID/start-token
  tracker is not treated as an installed feature.
- **P:** [current memory policy](desktop-memory-guard.md):27–37,94–100;
  `omp-config/bin/omp-engineer.py:92–102,135–185,607–620,746–786`.
- **K:** [kernel cgroup memory interface](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files)
  and [systemd resource controls](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html).
- **D/A:** E/`death-recovery-forensics.md`, `death-pinned-herdr-supplement.md`;
  installed `herdr-omp-agent-state.ts:279–311,375–471`;
  `omp-config/bin/omp-display.py:73–124`; hermes-config
  `scripts/host_alerts.py:850–861,955–962`, `scripts/outcomes.py:143–156,191–227`;
  `plugins/kaylee/checkin.py:43–59` (currently excludes lost from wake);
  [ADR-009](adr/009-nothing-fails-silently.md).
- **O:** E/`opus-memory-second-opinion.md`, independent Opus/high opinion,
  revised after challenge of kill-ordering and floor guarantees.

**Exercised:** journal/session reconstruction, live cgroup/process/PSS probes,
a real native headless blank tab (closed and its owned browser terminated),
and isolated existing-outcome-spool append/readback (same record, no parse
errors, scratch directory removed). The JS probe worker was also terminated.
**Not exercised:** live Kaylee delivery, deliberate scratch OOM, one-heartbeat
lost transition, new cgroup placement or SIGKILL recovery. Those are acceptance
criteria for implementation, not claimed results. No implementation test pass,
installer run, live deployment, push or PR is claimed.
