# Postmortem: the engineer fleet was one oomd victim

- **Incident:** 2026-09-26, 13:42:27 America/Chicago (UTC−05:00)
- **Status:** native fix verified and staged; live cutover deliberately pending
- **Owner:** workstation operator / harness; direct operator request, US-043

## Summary

**Confirmed cause of fleet loss:** systemd-oomd killed the shared terminal cgroup
containing Herdr and the engineers. At selection it held 43.9 GiB. Its parent
terminal slice throttled at 44 GiB; monitored `app.slice` exceeded 50% memory
pressure for more than 20 seconds. The optional development slice was effectively
empty. The operator reports every engineer and the chief-of-staff window died.
Saved agent transcripts survived; persistent data loss is not established.

**Strongest allocation suspect, medium confidence:** two concurrent OMP `find`
calls targeting large agent-state roots at 13:41:05.479. Neither returned before
the kill. The roots were later measured at roughly 53 GiB each. OMP 18.3.1's
embedded lexical implementation requests matching line content without explicit
result-count or column limits before reducing it to keyword counts. Its later
20-file/4-MiB read budget does not bound that preceding operation. The native
allocation ceiling was not established, and no historical per-PID memory series
was recovered: this is **not proof that those calls alone allocated the spike**.
A local eleven-story QA walk, started at 13:39:31, was another credible contributor.

## Timeline and evidence

Times CDT. Sources: timestamp-filtered system/user journal; existing user units;
saved tool-call/result events; OMP's embedded implementation. Raw transcripts stay
private. The suspect research transcript's session ID is
`01a0df04-8a8d-7363-a099-72baf43917ab`.

| Time | Observed |
| --- | --- |
| 13:40:20 | RAM usage 60.5%; swap occupied 45.85 GiB. |
| 13:41:20 | RAM 76.4%; swap 46.92 GiB; swap-growth warning delivered. |
| 13:42:21 | RAM 87.6%; swap 46.88 GiB; RAM warning delivered. |
| 13:42:27 | oomd considered 64 cgroups. `app.slice` pressure 50.13%; selected terminal pressure avg10 50.80%, memory 43.9 GiB. |
| 13:42:29 | Terminal scope failed `oom-kill`; lifetime peaks 44 GiB RAM and 23.9 GiB swap. |
| 13:43:21 | RAM fell to 48.9%; swap to 24.85 GiB. |

The victim ended in `app-Hyprland-xdg\x2dterminal\x2dexec-ad92ab4c.scope`, beneath
`app.slice/app-graphical.slice/app-graphical-terminal.slice`. Its parent limits
were high/max/swap 44/56/24 GiB. `dev-exec.slice` held only 98,304 bytes and zero
swap during the acute interval. The close match to the terminal's high/swap
limits is consistent with limit-induced reclaim; no surviving `memory.events`
snapshot separates that contribution from host-wide pressure. Lifetime peaks
need not be simultaneous. Subsequent Chromium failures do not establish Chromium
as the allocator.

September 17 also had two terminal-scope kills, but those were triggered by
system-wide swap exhaustion. September 26 was pressure-triggered. User-owned
`ManagedOOMPreference=omit` alone would not close both paths.

## Pokayoke

[The native guard](../desktop-memory-guard.md) starts unmodified Herdr as a user
service under `dev-fleet.slice`, outside the currently monitored application tree.
Restored and explicit-command panes inherit that boundary. The launcher refuses
unmanaged servers, missing/oversized bounds, covering oomd monitors and unreviewed
Herdr versions. A client-only native entrypoint avoids unmanaged auto-start.
`OOMPolicy=continue` prevents a child OOM from stopping the fleet service; it does
not promise that a kernel OOM can never select Herdr itself.

Two fixed job scopes provide local admission and independent bounds. Portable
heavy builds, suites, browser walks and renders default to existing project-owned
exe.dev workspaces. Agent sessions and credentials remain local. The allocator
lead was reported through OMP's issue-reporting channel; containment does not
make broad state-directory searches appropriate.

### Observed acceptance

On Herdr 0.9.1/systemd 261.2, disposable named session
`memory-guard-proof-8fy47l7j` exercised the installed CLI and native APIs:

- A 512-MiB, zero-swap service test killed allocating PID 3268135;
  `memory.events:oom_kill` rose **0 → 1**. Server 3222414 and sentinel 3263915
  survived, and a subsequent workspace-list request succeeded.
- Real OMP PID 3198310 restarted as PID 3223341 with `--resume=<same session>`.
  It, a restored shell, and an explicit-argv Python pane were observed in the
  bounded Herdr service cgroup. The old client scope disappeared on server restart.
- Both job scopes held their own 8/1-GiB memory/swap bounds; a third command
  returned **75 without executing**. Arguments, cwd and a synthetic environment
  value survived; a command returning **37** ran once and returned 37. Killing
  only a test launcher did not release its still-running descendant's slot.
- Both live oomd monitoring roots were `app.slice`, not ancestors of the fleet.
  The real unmanaged default server was refused without replacement. A stale
  60-GiB execution-slice limit also refused fleet startup; corrected limits passed.
- The disposable sessions and temporary overrides were removed. The original
  server remained PID **2207376**, start tick **139526598**. Live unit/drop-in and
  private-binding hashes were unchanged; old execution limits were restored.
- Filesystem portions of the rollback procedure restored exact original
  configuration after interruptions at 0, 1, 2, 3 and 4 unit writes. No real
  fleet cutover or graphical binding activation was performed.

Local redacted receipts: `~/.cache/tmp/desktop-guard-proof-8fy47l7j/`.
Final staged runtime SHA-256:
`1054105637a23891bc718fc8c31e3ce78300a87d8b77d1c8275071a3c1a0efc3`.
The final sibling-budget preflight tightening received a fresh cold-start check;
the restoration/OOM paths were unchanged.

## Follow-up

**Phaedrus owns the cutover time.** Follow the [exact cutover and rollback](../desktop-memory-guard.md#operator-cutover--restarts-every-engineer)
from an ordinary terminal outside Herdr. Cutover stops and restores the fleet;
staging is not live protection. Do not close this operational follow-up until
the default managed server and restored engineers have been read back after that
transition. No sudo or global oomd change is required.
