# Engineer memory: durable owners, isolated execution

**Design only — 2026-10-07 CDT.** Branch: `phaedrus/engineer-memory-cap`.
No implementation, deployment, running-scope changes, push or PR. Covers
**K-20261007-a-dead-engineer-never-shows-as-working**: a dead engineer must
show **lost within one heartbeat**, including the Trellis and Time Tracker
UI designers R90 reported as working for an hour after their deaths.

## Evidence: what died and what held memory

All seven were **leaf-limit OOMs**, not global OOMs: `CONSTRAINT_MEMCG`,
usage/limit `4194304kB`, zero swap and systemd `oom-kill`. Peaks censored at
4 GiB cannot justify a new cap. Raising it preserves the shared failure domain.
[J, U]

Times below are local CDT. Units are `omp-engineer-<suffix>.scope`. Charged
memory is MiB; victim anonymous RSS is KiB. Kernel statistics are approximate
snapshots. **Shmem is included in file**, not an additional charge.

| Kill | Scope suffix | Charged anon | Charged file / shmem | Charged kernel | Initial victim; anonymous RSS | Native-session reconstruction |
|---|---|---:|---:|---:|---|---|
| 10:34:57 | `eb4ea1a53330ea2dc25daffb` | 3757.3 | 184.8 / 184.2 | 153.7 | OMP 2662644; 1,845,136 | Outreach: 16 unyielded logical workers; nested fanout immediately before death. [J:40–52,156–157; F] |
| 11:54:42 | `e62afc1e2063d653edcfcef2` | 3832.3 | 177.0 / 176.8 | 86.3 | OMP 3866918; 1,749,284 | Resumed outreach: 20 workers started, 18 unyielded; unresolved lead wait. [J:229–241,363–364; F] |
| 12:21:24 | `c68181db8c22b65d30feda38` | 3667.8 | 297.7 / 297.6 | 130.5 | OMP 2664015; 1,238,548 | Family: eight-way, 60-fps film rendering began about five seconds earlier. Earlier site designers had disposed. [J:462–474,593–594; F] |
| 12:52:13 | `9f81174823f13ee94ba421c3` | 3792.4 | 240.8 / 240.4 | 62.8 | OMP 3735856; 3,173,884 | Wiki: latest lead prompt 115,494 tokens; five unfinished second-wave/audit workers. Large OMP address space; historical root-vs-eval identity is unverified. [J:691–703,819–820; F] |
| 16:36:51 | `8f6f7d5698f7b45cd0f54abc` | 3876.4 | 131.7 / 131.6 | 87.9 | OMP 2881515; 1,549,972 | Iron Forest: eight unfinished designers, latest prompt 740,043 tokens. Saved compaction completed later, not before this kill. [J:904–916,1026–1027; F] |
| 17:47:30 | `8f1338075f09108e793867a3` | 3893.2 | 142.2 / 136.0 | 60.5 | OMP 4166252; 1,447,480 | Trellis candidate: concurrent embedding and Whisper jobs; Python processes held 1,309,816 and 287,204 KiB anon. R90 reports both UI designers affected at 17:47. [J:1114–1126,1191–1228; F; Kaylee report] |
| 17:56:19 | `a891e51ec6ee81756923953f` | 3912.0 | 129.1 / 129.1 | 54.9 | Chromium 513864; 2,075,668 | Time Tracker candidate: accumulated tab openings and a dangling browser interaction. Group kill also took OMP 4163267, 1,123,936 KiB anon. [J:1304–1316,1410–1417; F] |

**Identity limit:** scope/victim joins are firm; historical PID/session and
root-vs-eval joins are not. Session candidates use timing/activity/recovery
messages. R90's 17:47 attribution remains user evidence; Time Tracker continues
through 17:56, so that precise join is unresolved. Each candidate has an
uncommitted tool/wait. [F]

During this investigation the journal also recorded **19:09:42, 19:10:02 and
19:23:51** 4-GiB leaf OOMs, initially selecting Chromium, xz and Chromium.
No session joins were made. [O2 raw:25–27,47–49,63–70]

The killed leaves were anon-dominated; nearly all their file charges were
shmem. Do not infer this from every 4G peak:

| Live observation | Measured ownership | Evidence |
|---|---|---|
| Own lead, three in-process agents active, 23:46:22Z | Lead anon 686.2 MiB; PSS 703.3 MiB. Scope current 3.891 GiB, including 2.445 GiB file and 696.6 MiB reclaimable slab; OOM counters zero. | `engineer-browser-before.json` |
| Controlled headless `about:blank`, 23:46:35Z | 13 browser/crashpad processes: aggregate PSS 292.35 MiB; broker PSS 87.16 MiB. Lead growth is confounded by concurrent agents. | `engineer-browser-opened.json` |
| Idle JS eval worker PID 1628, 00:20:17Z next UTC day | Actual argv `__omp_worker_js_eval_process`, parent lead PID 2; anon 156,024 KiB, RSS 223,684 KiB. | `engineer-js-kernel-probe.json` |
| Cage processes at first OOM | Two bwrap processes: anon 140/292 KiB; slirp: 35,988 KiB. Not dominant in that snapshot. | J:160–162 |

PSS avoids shared-map double counting; kernel group-kill messages also name
threads, so never sum victim RSS. Historical auxiliary OMPs resemble the
measured JS worker **[INFERENCE]**, without recovered argv/ownership. [J, N]

OMP 18.7.0's logical `AgentSession`s share the lead; completed sessions stay
warm seven minutes with journals/kernels/tabs. Compaction rebuilds display
history, not a proved RSS bound. The 740,100-token record completed at
23:37:26Z, after the 21:36:51Z OOM; no saved start proves a trigger.
**No post-GC heap profile:** anon RSS cannot distinguish JS objects, buffers,
allocator retention or native allocations. No leak is established. [N, F]

## Desktop budget: the current cap is not a fleet guarantee

At 23:43:54Z: 26 leaves, **38.209 GiB** current (anon **25.044**, file
**11.590**, kernel **1.547**). Their **104-GiB** theoretical ceilings exceed
**91.958-GiB** RAM minus the **20-GiB** floor. `omp.slice` is unlimited;
the floor/36-GiB guide are advisory. [L, P]

| Snapshot UTC | Available GiB | Margin above floor GiB | Unused dev-exec ceiling GiB |
|---|---:|---:|---:|
| 23:53:07 | 27.021 | 7.021 | 10.068 |
| 01:03:16 next day | 26.181 | 6.181 | 10.911 |

Heavy execution alone can consume the margin. The later `omp.slice` held
**41.821 GiB**; count 29 scopes is not a verified per-leaf-cap sum.
Include heavy/legacy/uncaged work and non-agent bursts, not launch count. [B; O2 raw:7–21]

**One approved hard non-desktop-work budget plus admission/backpressure.**
Moving from advisory requires Phaedrus's approval. Fit the ceiling to measured
non-agent demand, the floor and burst allowance; capped peaks supply no number.
`fleet.current + MemAvailable - 20` double-counts reclaimable fleet cache;
`memory.high` can be exceeded. Neither guarantees the floor against unbounded
unrelated desktop demand. The guarantee is conditional. [B, P, K]

## Concrete option: local Pi Durable engineers

The lab is a real ticket-engineering path, not a memory benchmark or an OMP
replacement. `eng` resolves to `~/development/misty-step/harness-lab/grok/bin/eng`;
it declares one Node owner/SQLite per engineer with `MemoryMax=4G`,
`Restart=on-failure`, `RestartSec=2`, zero swap and `OOMPolicy=continue`.
Kaylee's SIGKILL/resume result is accepted, not rerun. The retained r1 record
also reports a 1-GB tool bomb killed while its owner and another engineer
survived. **Continue permits survival; it does not guarantee the kernel will
choose a child instead of the owner.** [G:eng.ts:50–64; R1:135–164]

Owners exit after passing or parking on a human question; durable input can
start them again. That is a concrete cold-state benefit over keeping a TUI
resident, not proof that equal-feature native workloads use less memory. [G]

Fresh measurements used the installed Pi 1.0.0 SDK, Node 26.8.1, private HOME
and network-disabled ModelRuntime, real Harness/SQLite/CodingTools, and a
**faux provider, not native model engineering**. Samples are UTC. [Q]

| Pi probe | Private anon MiB | PSS MiB | Meaning |
|---|---:|---:|---|
| One idle owner, 00:52:34Z | 98.8 | 150.3 | Full runtime/provider-catalog startup; zero model requests. |
| Twenty active conversations, 00:52:34Z | 145.3 | 196.8 | Each has 512 KiB synthetic input and a held read-only tool; all share one process. |
| Two independent idle owners, 01:03:44Z, summed | 195.7 | 247.4 | Separate processes/files; real isolation has a resident-runtime cost. |

Retained native tasks report **383 MB**, then **1.2 GB including Python/tests**
for r2, and **412 MB** for r3. These are the reviews' recorded scope peaks,
not normalized PSS or matched OMP workloads. The 700k-token/native-browser/
specialist workload is unmeasured on this path; neither these records nor the
synthetic probe establishes a savings ratio or safe cap. R3's 5.03M Sol tokens,
97% cached, concern different shipped work from its OMP comparison—not dollar
parity. [R2:86; R3:98–109]

| Contract | Lab today | Cost of a real default |
|---|---|---|
| Subagents, forks, cancellation | No task/fork/cancel tool. SDK owned conversations/forks exist **in-process**; `eng stop` is resumable unit stop. | Expose owned results, cancellation and scoped workspaces; independent model workers need their own owner/store, not a second writer on the parent's SQLite. |
| Browser and engineering tools | Four coding tools; no browser, image reader, eval, LSP or structured find. Built-in read rejects images. | Reuse approved headless/tool boundaries and typed results; a shell command is not browser parity. Box browser/command trees separately. |
| Skills and guidance | Only cwd `AGENTS.md`; no shared global/ancestor loader, nested guidance or lazy skill inventory. | Reuse existing guidance and lazy metadata/body loading, including sandbox/display/audio rules—not every CLI/UI extension. |
| Herdr steering | Headless status/watch plus durable `eng say` inbox, not PTY input. | A pane is a view/client, not the owner. Carry existing authored request IDs and steer/follow-up mode; distinguish queued from admitted/delivered. |
| Kaylee/Glass | Durable readers exist. r5 proved controlled omission/return with a sleep surrogate and a fresh installed fleet reader. Current-desk activation, natural subagent waiting and delivery/cancellation remain unproved. | Preserve existing commission/notice authority; prove the real active consumer journey and root-lost deadline. No new fleet ledger. |
| Models and containment | Codex default; CLI rejects Anthropic. ModelRuntime does not load Pi CLI account-pool/failover guards. NodeExecutionEnv's cwd is **not a sandbox**. | Enforce native Pi route policy at every inference, preserve approved subscriptions/pools, and reuse containment. Opus/Claude-only lanes cannot silently become Pi/Codex lanes. |

The actual readonly `status.ts` took **0.040 s**, sampled peak RSS **71.3 MiB**
on retained r4. Installed `eng status --all --json` read nine retained jobs in
**0.098 s**, sampled RSS **87.0 MiB**. This is a small-history reader baseline,
not fleet-scale qualification: it scans stored history. More importantly,
it returned success and nine `stopped` rows with `undefined/undefined` units
while a direct unit query failed because this cage has no user bus.
**These are not live-unit measurements.** Failed observation must become
unknown/error, never fabricate stopped, done or working. [Q]

Default intake must retain commissioned scope/mode, model authority and review
stops—not apply the lab's uniform clone/push-PR brief to every task. [G, C]

Before defaulting eligible engineers: acquire one lifetime owner lock, select
and read back **FULL** on the writer connection, pin the runtime/spec and prove
restore with worktree/originals. The fresh connection reported
`PRAGMA synchronous=1` (**NORMAL**); SIGKILL recovery does not prove power-loss
durability. Reconcile interrupted external effects: the lab reviewer declares
`replay: safe` yet can post a PR comment, and acceptance bash runs outside its
durable tool transaction. Input deduplication is not exactly-once effects or
model spending. Replace the per-launch mutation of shared `harnesslab.slice`
to **8G** with the approved aggregate admission/budget owner; don't promote
that lab policy. Then migrate launch, steering, status, completion and recovery
together. A symlink/install alone changes no dispatch default. [G; C; Q]

## Concrete option: Iron Forest cloud instances

**Implemented today:** local Rust scheduler/`controller.sqlite`; Pi Durable
1.0.4 inside agent turns, exact accepted-head continuation and Rust-custodied
Code Mode capabilities. M8/M9 have retained native-use proof; M10 daily-use
repairs are authorized. Executable plans refuse non-local placement.
**Not implemented/qualified:** IronForestDO or a hosted Pi workflow owner.
`RUNTIME.md` §8 supersedes Astra's older M7 status. [I]

The intended instance is **one SQLite IronForestDO per controller workspace**:
official PiHarness/Lifecycle owns tasks, history and wakeups; Rust/Wasm owns
domain permissions/acceptance. Bounded Code Mode isolates and independent
Linux Containers execute tools; **R2 originals** hold exact source, runtime
bytes, captures and receipts. No Rust scheduler beside Pi, AgentDO mirror,
Workflows or D1 around the same run. Workspace-wide authority is coherent,
but poisoned/full authority storage affects every run in that workspace;
separate helpers do not isolate SQL failure. [I:RUNTIME:28–59,199–220]

[PiHarness](https://developers.cloudflare.com/agents/harnesses/pi/) is available
in beta with SQLite and alarm recovery, not a promise of Forest conformance.
The control isolate has a documented
[128-MB limit](https://developers.cloudflare.com/workers/platform/limits/);
[SQLite DO rows/BLOBs are limited to 2 MB](https://developers.cloudflare.com/durable-objects/platform/limits/).
It is not a relocated 4-GiB Linux engineer. Bound model working sets and put
bulk assets/originals outside the control heap. Our Node PSS is not a workerd
heap benchmark. Conversations in one DO share its control runtime, not
independent boxes. PiHarness's **30-second recovery heartbeat** does not provide
the proposed 10-second lost deadline; snapshot streams are not death-event
cursors. Hosted liveness needs its own end-to-end qualification.

Concrete heavy-box shapes include `standard-1` **0.5 vCPU/4 GiB/8 GB disk**
and `standard-3` **2 vCPU/8 GiB/16 GB disk**. These are available shapes, not
selected caps or measured cloud peaks. At
[published rates](https://developers.cloudflare.com/containers/platform/pricing/),
five fully CPU-active minutes of standard-1 is about **$0.0062** in RAM/CPU/disk;
awake idle costs about **$0.038/hour**, before allowances, models, DO/Workers,
logs and egress. Arithmetic, not a cloud bill or success/latency benchmark.
Sleep helpers between jobs. With the beta
[`durable_object` scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/),
`max_instances` is unsupported: the authority must actually limit admitted
helpers/resource spend, not trust that configuration knob.

**First work off this machine:** one frozen read-only compile/check recipe,
exact source/recipe in and retained logs/digest/result out, with independent
RAM/wall/output limits, cancellation and uncertain-result reconciliation.
Next, headless browser/render jobs for declared previews/public content:
this directly targets the measured Chromium/render workload, without moving
the model login. Native GUI/GPU, interactive authentication and unapproved
private data stay local. Start with remote **tools**, not a whole cloud agent.
An approved project VM is usable under its existing authority; a new hosted
Forest slice requires separate hosting/data/spend approval. [I; J; C]

Whole-cloud engineers additionally require the local workflow-boundary
qualification, exclusive owner, accepted-head/launch fencing, hosted storage
conformance, alarm/cold restart, uncertain-commit reconciliation and restore
with retained originals/runtime. Container snapshots preserve files, not
process RAM or archival custody. Current Forest native inference is an
approved local Codex subscription route and rejects refresh/fallback; keep
credentials local and qualify a provider bridge, or obtain explicit route
authority. A Workers AI/OpenRouter example is not permission to replace it.
Hosted M10d is separately commissioned, not already approved/deployed. [I]

## Options and recommendation

Two independent **Opus/high** opinions preceded selection. The expanded opinion
initially favored OMP and ungrouping first; after challenge, it agreed on exact
root liveness, one end-to-end H and the OOM-event first PR. Agree that OMP is
today's qualified default; do not mistake that for evidence against durable
local adoption. Its full opinion, corrections and raw citations are retained.
Ungrouping changes victim handling, not ownership; partial tool-tree survival/
hangs remain unproved. Scope disappearance is not root liveness. [O, O2]

| Design | What it buys | Decisive tradeoff |
|---|---|---|
| Repair OMP: bounded shared lead plus isolated OS helpers | Retains current tools/models/panes; real helper fault boundaries. | Native retention/admission and crash-interruption work still needed; no heap profile yet. Best current production path. |
| **Local Pi Durable work units, independent heavy cells** | Persisted intent/inbox/checkpoints; cold human waits; standard supervision rather than a permanent model TUI. | Parity, route guards, owner/durability and liveness gates above. **Selected adoption target, not today's default.** |
| Whole IronForestDO/cloud engineer | Moves control/history and execution off the desktop. | Hosted custody, bounded isolate, provider bridge, restore and permissions unqualified. Not the first migration. |
| Ungroup the shared leaf only | Minimal mitigation; the lab shows one helper OOM survived. | Kernel can still choose the lead; in-process peers still die together. No guaranteed helper isolation or recovery. |

**Recommend a staged hybrid:** keep qualified OMP launches now; qualify Pi
Durable for eligible local Codex engineering, with portable heavy tools moved
off-machine first. Preserve explicit Opus/visual lanes until their model and
tool contracts have an authorized equivalent. Do not wrap OMP in a Pi task
and call that a durable cutover, or maintain two workflow owners for one run.
Pi earns the default through matched same-model/same-task acceptance, including
subagents/browser where required and uncensored memory—not these idle figures.
Full-fleet Pi default additionally needs an explicit decision about incompatible
model lanes; this design grants no Anthropic-in-Pi or paid fallback authority.

### Boxes and limit behavior

- **Box existing OS helpers first:** a broker+Chromium tree, eval kernel,
  build/compression/ML command tree. Group-OOM within each coherent tree avoids
  half-dead tools; unrelated model/tool siblings never share group kill.
  Native launch authority places them before allocation. Moving a live process
  does not move its existing memory charges. [K]
- Keep cheap logical conversations in-process initially. Their synthetic cost
  is measured, but their failure domain remains shared. Separate model-worker
  processes only when independent fault containment or measured working sets
  justify their runtime/IPC cost; each has its own store, never a second parent
  scheduler. Bound admission across the **whole spawn tree**, park completed
  state and release owned tabs/kernels promptly.
  Preserve active-run kernel state; report lost ephemeral state on cold revival.
- Preserve the desktop backstop. An ungrouped accounting parent's bound must
  cover admitted child bounds plus infrastructure; otherwise it recreates the
  shared OOM domain. Helper-pool exhaustion must not select a lead. Account
  charges until processes/resources drain, not until a row says lost.
  At aggregate exhaustion the desktop backstop wins: coherent worker loss,
  not a fleet-wide group kill.
- **Before the limit:** defer new work, cold-park state, release owned resources
  and move portable work. `memory.high` alone can turn unreclaimable memory
  into a hang. **At a helper limit:** kill that tree and report interrupted/
  unknown result. **At a lead limit:** lose that incarnation loudly, retain
  work and recover the exact checkpoint after reconciliation. Do not restart
  the same over-limit working set repeatedly; OOM recovery needs a hold or
  changed placement/admission, not an unconditional two-second loop.
- Reuse systemd, launch authority, existing commission/outcome routes and one
  state owner. Replace all-peer exact-4GiB verification with **launch-role**
  controls/placement verification at cutover. No priority fixer, shadow memory
  ledger or second scheduler. Numeric limits still require uncensored profiles
  and concurrent-burst measurements; no running scope is changed.
  Changes to approved cap/group semantics need Phaedrus's authorization and
  the exact-head story-deletion check before removing old checks.

## Death must be owned outside the failed process

Herdr reports version 0.9.1. That version's identified-agent loop sleeps 300 ms,
but its actual process probes have longer gates and can be skipped indefinitely
under unchanged foreground-group/full-hook authority. Installed OMP hooks are
transition-driven, not liveness heartbeats. No explicit `lost` status exists.
This is a concrete source-level gap consistent with the reported stale state,
not proof of which path froze either pane. Terminal synchronized-output state
is another possible presentation mechanism **[INFERENCE]**. [H, D]

**Required for K-20261007:** bind `(runtime job/session, incarnation, host root
PID + start token/pidfd, systemd invocation, optional pane generation)` at the
trusted launch handoff. OMP's root is its native lead; Pi's is the SQLite owner,
not its pane/watch client. Scope population, a surviving wrapper/helper and
the hook CLI's authenticated peer PID are not that identity. A scope has no
main process; even a service MainPID is insufficient if it identifies a wrapper
rather than the real owner. [D, O2]

The outside presence owner publishes a retained **lost tombstone within
H=10 seconds end-to-end**, the existing Kaylee fleet heartbeat, independently
of hooks/screens. This is a proposed contract, not measured performance.
Retain recovery identity and every death event even if a new incarnation has
resumed; never mark it lost using an old exit. Co-resident logical workers
share the loss. Root death, job outcome and OOM cause are separate: stale
receipts cannot hide failure; expected cold exit is not loss. A healthy long
tool/provider call needs no hook heartbeat.

The pane and roster must stop asserting working even if the PTY, wrapper,
helpers or final frame remain. Kaylee must consume lost as a wake event,
including uncommissioned engineers, rather than wait for a quiet model turn.
Herdr's 300-ms tick is a detector opportunity, not another SLA. Bound all checks
inside H; use event push/cache invalidation, not serial polling delays.
Pane, authoritative API and Kaylee must agree. Shell return or Glass unknown-
hold alone is not proof; five-minute outcome delivery is not this deadline. [D, O2]

OOM evidence comes from kernel/systemd, not exit 137. Observe the systemd
OOM message class `fe6faa94e7774663a0da52717891d8ef`, unit and invocation;
do not depend only on `UNIT_RESULT=oom-kill`. The retained continue-policy
lab unit logged OOM and finished successfully after its helper died.
`--collect` does not erase durable journal evidence. Neither an OOM message
nor an active unit proves whether the **root** survived. [U; G:runs/r2/unit.txt:1–24; O2]

Recover the exact session/checkpoint and retained runtime/worktree, not the
newest JSONL or SQLite file. Today's dangling tool starts have unknown effects;
OMP's interrupted-result synthesis depends on exit evidence a SIGKILL cannot
write. Pi's unsafe-tool interruption is useful but its replay declarations need
audit. Persist the interruption boundary through the state owner; reconcile
external state before retrying. Never silently replay effects or resend a
follow-up as new authority. [F, N, G]

## First small PR and rollout

**First PR: every verified engineer OOM enters the existing outcome route.**
Add a narrow adapter to hermes-config's **existing host-alert sweep**, using
`run_record/append`. Classify by OOM message ID; retain boot/unit/invocation,
journal cursor, victim PID, cause/time and known identity. Cursor distinguishes
repeated OOMs in one invocation; root-loss identity must match any surviving-
launcher fast path. Spool before checkpointing. Report root death separately
from helper OOM or unknown root fate. Preserve unrelated transient-experiment
suppression. No watcher, ledger, cap, policy or running-scope mutation. [D, A, O2]

Acceptance: a registered scratch-engineer OOM reaches Kaylee after collection,
even with its wrapper dead; reread deduplicates, a second OOM remains distinct,
and unrelated intentional transient failures stay suppressed. Continue-policy
helper OOM also records an event without falsely declaring the owner dead.

**This does not close K-20261007.** Next land the trusted incarnation handoff
and authoritative lost projection, including actual pane/API rendering and
Kaylee wake. Scratch-kill the root with a surviving helper/frozen frame/long
tool: all surfaces lost within H; healthy long calls remain live; stale exits
cannot erase resumed ownership. Don't claim no Herdr change is needed before
this proof.

Then qualify Pi's owner/FULL/replay/route/guidance/consumer contracts on a real
eligible ticket, isolate helpers and approve aggregate admission. Compare
matched workload peaks before changing defaults or role limits. Commission one
remote frozen check, then browser/render execution; full cloud ownership follows
Forest's local-boundary/hosted-restore qualification. Natural launches only.
No implementation, deployment or hosting authority is granted here.

## Evidence references and verification boundary

Private investigation evidence directory **E**:
`~/.omp/agent/sessions/-.herdr-worktrees-harness-phaedrus-engineer-memory-cap/2026-10-07T23-35-08-877Z_01a118b8-874d-7197-847b-ebb2d9a9a0fd/local/`.
Live-table filenames are under E; measurements are UTC. Detailed reports retain
the native transcript paths and exact line/call identities, not just timing.

- **J/U:** E/`engineer-seven-kernel-unfiltered.log` and
  `engineer-seven-kernel-measurements.json`; kernel ±3-second journal windows
  and user Failed/Consumed records. Kernel line ranges are in the table.
- **F:** E/`kill-session-forensics.md`, `kill-kernel-forensics-supplement.md`;
  exact native transcript paths/entries and association qualifications.
- **L/B:** E/`engineer-live-cgroup-sample.json` (23:43:54Z),
  `engineer-host-budget-probe.json` (23:53:07Z).
- **N:** [official OMP 18.7.0](https://github.com/can1357/oh-my-pi/tree/v18.7.0),
  installed binary matched its Linux-x64 release: `task/executor.ts:4366–4398`,
  `task/settings.ts`; `session/{agent-session,session-manager,session-maintenance}.ts`;
  `eval/js/context-manager.ts:125`, `session/exit-diagnostics.ts:102–199`.
  Full source/provenance is retained in O/F.
- **H:** [Herdr 0.9.1, 065ef9d6](https://github.com/herdrdev/herdr/blob/065ef9d6a531c49fb8bee7e818ef837065b21ee9/src/pane.rs):
  `:312–320,470–531,2460–2462,2597–2600`; `detect/mod.rs:11–20`.
- **P:** [memory policy](desktop-memory-guard.md):27–37,94–100;
  `omp-config/bin/omp-engineer.py:92–185,607–620,746–786`.
- **K:** [kernel cgroup memory](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files),
  [systemd controls](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html).
- **D/A:** E/`death-recovery-forensics.md`, `death-pinned-herdr-supplement.md`;
  hermes-config `scripts/{host_alerts,outcomes}.py`,
  `plugins/kaylee/checkin.py:43–59`; [ADR-009](adr/009-nothing-fails-silently.md).
- **O/O2:** E/`opus-memory-second-opinion.md`, `opus-strategic-runtime-opinion.md`,
  `opus-strategic-raw-citations.txt`, `opus-strategic-runtime-followup.txt`;
  independent Opus/high opinions and corrections; second used
  `anthropic/claude-opus-5-5:high`. “O2 raw” denotes the preserved raw text.
- **G:** `~/development/misty-step/harness-lab/grok/`: `eng.ts:35–64,67–155`;
  `engineer.ts:51–146,166–257`; `status.ts:4–65`;
  Pi Durable 1.0.0 `dist/storage/sqlite/node.js:150–176`,
  `dist/harness/tool.js:56–92`, `dist/tools/index.js:1–14`, `dist/tools/read.js:16–35`.
- **R1/R2/R3/R5:** `~/review/harness-lab/opus-r{1,2,3,5}.html`, line ranges
  cited above; R5:62–107 and `opus-r5/host-walk.json`. These are retained
  reports, not rerun tests or proof of today's loaded desk.
- **Q:** E/`pi-durable-runtime-memory.json`,
  `pi-durable-independent-owner-memory.json`, `pi-durable-reader-cost.json`,
  `pi-durable-codingtool-smoke.json`, `pi-durable-probe-method.json`.
- **C:** E/`pi-durable-parity-comparison.md`, exact SDK/context/consumer seams;
  Kaylee `phaedrus-lane-heartbeat-capture/plugins/kaylee/fleet.py:114–182,327–354`,
  `__init__.py:914–939`; Glass `phaedrus-alert-all-status/internal/sources/herdr/herdr.go:258–374`.
- **I:** `~/development/misty-step/iron-forest-private/docs/design/`:
  `RUNTIME.md:28–59,130–144,199–290`, `pi-durable-astra.md:97–108`;
  private `REPORT.md:85–143`. Actual `~/development/misty-step/iron-forest/`:
  `ARCHITECTURE.md:3–64`, `platform/pi-turn-host.mjs:103–224`,
  `src/compile.rs:1145–1155`; E/`iron-forest-cloud-comparison.md` retains
  exact capability, custody, limits, restore and hosting citations.

**Exercised:** journal/session reconstruction, live cgroup/process/PSS probes,
a native headless blank tab, isolated existing-outcome-spool append/readback;
fresh real Pi SDK owners/storage, twenty synthetic concurrent conversations,
real CodingTools bash with a faux provider, readonly native-lab database and
installed fleet CLI. Owned probe processes exited; scratch databases/scripts
were removed. Historical SIGKILL/native ticket/Glass proofs were read, not rerun.
**Not exercised:** native Pi feature/workload parity, live Kaylee delivery,
deliberate new OOM, lost-within-H, new cgroup placement, cloud execution/restore
or default cutover. These remain implementation acceptance, not claimed results.
No implementation tests, installer, live deployment, push or PR.
