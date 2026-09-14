# Postmortem: workstation memory exhaustion during concurrent development work

- **Incident date:** 2026-09-09
- **Observed acute window:** 18:31:52–18:34:18 America/Chicago (CDT, UTC−05:00)
- **Status:** incident ended; diagnosis incomplete; mitigations proposed, not implemented
- **Operational owner:** operator / omp-config; individual follow-up owners unassigned
- **Intended tracker:** [omp-config in Misty Step Linear](https://linear.app/misty-step/project/omp-config-47a74679f980)
- **Publication:** repository draft; not yet published to Linear

## Summary

A development workstation with approximately 92 GiB of usable RAM experienced severe memory exhaustion. Occupied swap grew from approximately 42.6 GiB to 161.0 GiB in 112 seconds. At 18:33:47, systemd-oomd killed a long-lived terminal scope responsible for approximately 148.4 GiB of swap usage. Electron then trapped, and multiple Chromium processes aborted.

The confirmed failure was system-wide memory pressure associated with a heavily consuming terminal process group. The individual workload responsible, its allocation behavior, and the precise condition triggering Electron's fatal trap remain unproven. The evidence does not establish an Electron memory leak, a fork bomb, excessive agent count by itself, or an Omarchy defect.

The actionable containment gap is clear: application slices had no configured memory, swap, or task limits. Development workloads could exhaust the workstation before a machine-wide OOM response intervened.

## Impact

- systemd-oomd killed processes within a development terminal scope that had existed for more than two days.
- Electron PID 3979724 terminated with SIGTRAP during a Playwright-driven verification launch.
- Multiple Chromium processes terminated with SIGABRT within the next few seconds.
- Some crash records were dropped because too many core-dump connections arrived together.
- The exact number of interrupted jobs and any unsaved work lost were not established.
- File deletion or persistent application-data corruption was not established. Isolated verification state files and backup generations survived. The checked user Trash metadata directory was empty.

This report deliberately omits private repository names, full home-directory paths, unrelated journal contents, credentials, and raw core dumps.

## Timeline

All times are CDT on 2026-09-09. The first recorded allocation warning is not necessarily the start of memory growth.

| Time | Observation |
| --- | --- |
| 18:31:52 | Kernel records a page-allocation failure in an `omp` process; swap occupancy approximately 42.6 GiB. |
| 18:32:44 | Allocation failure in `auth.test`; swap occupancy approximately 94.8 GiB. |
| 18:33:23 | Allocation failure in another `omp` process; swap occupancy approximately 134.1 GiB. |
| 18:33:44 | Allocation failure in `tokio-runtime-w`; swap occupancy approximately 161.0 GiB. |
| 18:33:47 | systemd-oomd acts with RAM usage approximately 95.7% and swap usage approximately 90.1%; selected terminal scope uses approximately 148.4 GiB of swap. |
| 18:33:48 | Kernel records Electron PID 3979724 executing an `int3` trap. |
| 18:33:49–18:33:51 | Multiple Chromium processes abort; core-dump intake drops some connections. |
| 18:34:15 | Electron's core-dump report completes. This is the notification timestamp, not the actual trap time. |
| 18:34:18 | Electron core-dump processing and scope accounting finish. |

## Evidence and mechanism

### Rapid memory growth

Kernel memory snapshots show:

| Time | Occupied swap | Page tables | Kernel stacks |
| --- | ---: | ---: | ---: |
| 18:31:52 | 42.6 GiB | 0.93 GiB | 259 MiB |
| 18:32:44 | 94.8 GiB | 3.07 GiB | 639 MiB |
| 18:33:23 | 134.1 GiB | 4.58 GiB | 903 MiB |
| 18:33:44 | 161.0 GiB | 5.50 GiB | 1,071 MiB |

Approximately 118 GiB entered swap in 112 seconds, an average net growth near 1 GiB/s. File cache shrank sharply as the kernel reclaimed memory.

**Inference:** simultaneous growth in page-table and kernel-stack memory is consistent with substantial expansion of address spaces and execution contexts, such as worker fan-out. It does not prove recursive process spawning or identify a launcher. Allocation-warning process names identify processes unable to allocate, not necessarily the dominant consumers.

### Swap was not all independent capacity

The observed swap configuration was approximately 92 GiB of disk-backed swap plus 92 GiB of higher-priority zram using zstd compression. Zram stores compressed pages in physical RAM; its advertised logical capacity cannot simply be added to physical RAM as independent storage.

At 18:33:44, approximately 43 GiB was resident anonymous memory, 28.5 GiB was the kernel's `zspages` allocation, 5.5 GiB was page tables, and 1 GiB was kernel stacks. These rounded categories explain substantial physical pressure; they are not a complete accounting identity. Remaining memory included file cache, slab, and other kernel allocations.

### The terminal group, not the newly launched Electron, dominated accounting

The selected scope was `app-Hyprland-xdg\\x2dterminal\\x2dexec-ea05a5ca.scope`. Its final accounting reported 72 GiB peak memory and 148.7 GiB peak swap over more than two days. Peaks are scope-wide and need not be simultaneous.

Electron was in a different scope, whose reported memory peak was only 262.1 MiB. Its command line showed Electron 40.4.1 launched through Playwright's Electron loader, with inspector and remote-debugging endpoints. This strongly argues against that Electron instance being the dominant memory consumer.

### Electron's immediate cause remains unresolved

The executable and core confirm a deliberate native `int3` trap, rather than direct OOMD SIGKILL. The core was truncated at 32 GiB. GDB found 43 thread records, but their stack memory was unavailable, preventing reliable caller backtraces. Nearby executable strings and nearest exported-symbol labels are not sufficient to identify the fatal condition.

**Inference:** memory exhaustion or a dependency failure during the incident likely triggered Electron's fatal path. Nearby display-connection errors do not establish that specific chain. The temporary extracted core was deleted after inspection; systemd's original was left untouched.

## Contributing conditions

1. **No meaningful aggregate application memory boundary.** `app.slice` and `app-graphical.slice` reported `MemoryHigh`, `MemoryMax`, `MemorySwapMax`, and `TasksMax` as infinity. The user slice also had unlimited memory/swap settings and a task ceiling of 247,889.
2. **Broad failure boundary.** A long-lived terminal scope accumulated descendant workloads. OOMD's selected unit was broader than one verification job.
3. **Compressed swap competes for physical memory.** Zram helped extend capacity but did not provide independent disk-backed headroom.
4. **Insufficient historical attribution.** Checked atop, process-accounting, and sysstat services were inactive; checked atop/sysstat archive directories were absent. The journal preserved group totals, not a historical per-process ranking.

## What we did not establish

- The exact command, repository, agent, or child process responsible for growth.
- Whether growth came from worker fan-out, repeated launches, a memory leak, or another mechanism.
- Whether the number of conversational agents was excessive. A later sample showed approximately 6 GiB resident across 15 OMP processes, but post-crash measurements cannot reconstruct the killed workload.
- Whether any specific pending edit or unsaved browser state was lost.
- A causal package-update or Omarchy regression.

The absence of atop accounting is not proof that attribution is impossible. An authorized, narrowly scoped review of operator-held launch/tool records around 18:30–18:34 may still identify commands and overlapping runs. That review was not completed in this investigation. Do not reproduce the unbounded workload merely to recover attribution.

## Response and recovery

systemd-oomd terminated the selected process group. Subsequent measurements showed ample available memory. Investigation used coredumpctl, timestamp-filtered journal queries, executable disassembly, GDB core inspection, swap inspection, systemd properties, and surviving artifact metadata. No workload limits, application configuration, infrastructure, or code were changed. No upstream report was filed because no Omarchy-controlled defect was established.

## Prevention proposals

These are proposals, not deployed settings, assigned work, or permission to provision infrastructure.

### Separate agent concurrency from execution concurrency

Keep many agents available for research, editing, and model calls, while applying a shared machine-wide budget to expensive builds, test suites, browser verification, and container workloads. A starting experiment is two simultaneous heavy verification jobs with 2–4 workers per runner. Queue additional heavy commands instead of blocking all useful agent activity. Tune against representative workloads rather than treating these numbers as proven optima.

### Bound aggregate and per-job resources

Introduce a dedicated development-execution slice with separate child units per job. Suggested initial evaluation values:

| Boundary | MemoryHigh | MemoryMax | MemorySwapMax |
| --- | ---: | ---: | ---: |
| Aggregate local development execution | 48 GiB | 60 GiB | 8 GiB |
| Ordinary heavy verification job | 6 GiB | 10 GiB | 1 GiB |

Set per-job task ceilings from measured thread/process counts. MemoryHigh induces reclaim pressure; MemoryMax is a hard stop and may fail a job. The desired failure is one bounded job failing without disrupting the desktop or unrelated work. An aggregate cap leaves headroom but is not a guaranteed reservation for the desktop.

Apply containment at actual execution boundaries: Docker-daemon-created containers and systemd-launched applications can run outside the caller's cgroup. Wrapping only the agent executable is insufficient. Handle lifecycle cleanup of job-owned services without killing unrelated services.

### Offload portable execution to exe.dev

Keep native desktop, GPU, and data-constrained work local. Consider moving complete approved project workspaces—agent, checkout, build/test services, and artifacts—to bounded persistent VMs for backend tests, headless browser verification, and long-running work. Prefer one VM per active project or trust boundary where appropriate, not automatically one VM per conversational agent.

Resolve account, capacity/spend, repository and credential authorization, exposure, backup needs, and lifetime before provisioning or transferring data. Approval for personal projects is not approval to transfer client repositories. VMs still require worker and memory limits.

References: [exe.dev agent workspaces](https://exe.dev/docs/use-case-agent.md), [resource resizing](https://exe.dev/docs/cli-resize.md).

### Preserve lightweight historical attribution

Record bounded per-job metadata: identity, cgroup, start/end, peak memory, exit reason, and periodic memory/swap measurements. Alert on sustained pressure before machine-wide failure. Exclude environments, secrets, private payloads, and sensitive command arguments; define retention.

## Follow-up acceptance criteria

- A deliberately bounded synthetic memory/task stress job fails within its own boundary while an unrelated sentinel and the desktop remain responsive.
- Aggregate limits cover actual child execution, including separately launched containers/services or explicitly document exclusions.
- Concurrent heavy jobs obey the shared admission budget and clean up only their owned processes.
- Normal representative verification completes within the selected budgets, with peak usage recorded.
- Historical records can attribute a stopped job without exposing secrets or retaining core memory.
- Any remote pilot uses explicitly authorized inputs and account capacity, with inspectable artifacts and a documented lifetime.

No stress experiment was run as part of this postmortem. These criteria describe future verification, not observed results.
