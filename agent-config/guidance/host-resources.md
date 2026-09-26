## Host resources

Desktop RAM is shared with the operator.

- **exe.dev default:** Run portable heavy work through `ws` in the project's owned exe.dev workspace: full suites, coverage, browser/Electron walks, large builds and type-checks, renders, and long-running services (`skill://using-exe-dev`). GitHub-hosted CI is exempt. Standing approval covers one owned `<project>-ws` per project within the existing $40 plan; other VMs need approval. Keep agent sessions and model credentials local pending a separate decision.
- **Local exception boundary (US-043):** Native desktop/GPU and data-constrained heavy work stays local; on a workstation with the desktop guard activated, launch it with `desktop-guard run -- <command>`. Two jobs can run; a third is refused, not run unbounded. Do not bypass admission with another unit name or an unbounded daemon. Lightweight inspection and bounded low-concurrency checks may stay local. Daemon-created containers need their own bounds; a bounded client does not contain a Docker daemon's work.
- **Fleet boundary:** The managed Herdr server and restored panes inherit a bounded user-service hierarchy outside `app.slice`. Staged files are not activation. Never restart the fleet or change its limits to activate a guard; follow the operator-owned cutover in the [desktop memory runbook](https://github.com/misty-step/harness/blob/master/docs/desktop-memory-guard.md). This bounds inherited allocations, including in-process tools, but does not make a broad search safe or guarantee which process a kernel OOM selects.
- **Runner budgets:** When running bounded checks locally, cap runner concurrency in repo config, never the host default.
- **Scratch directory:** Always use run-scoped `TMPDIR` under `~/.cache/tmp`, never `/tmp` (RAM tmpfs). Clean up on exit.
- **Agent audio:** Your sessions play into the silent `agent-sandbox` sink (US-026); the operator hears nothing. Verify sound by recording it: a default `pw-record` or `parecord` captures the sandbox monitor. Hand renders over as files; the operator chooses when to listen. Never unset the routing variables that `$AGENT_AUDIO_SANDBOX` lists or target a hardware device.
- **Fleet hygiene:** Check for existing runs and `git worktree list --porcelain`
  in the affected repository before creating another checkout. Keep one
  canonical checkout per repository: parallel writers use the harness's native
  isolated delegation where it exists, and a worktree is only for a separate
  top-level session that needs its own branch. Stop only processes owned by this
  session. In-session `git worktree add` and non-standing VM creates take a
  `session-close.ts add` lease in the same turn; `ws up` leases each remote task
  worktree. Wrap checks only the caller's own live leases. Review stale, expired,
  or ownerless leases rather than deleting them. At completion, inspect
  Git-visible changes, ignored artifacts, and the branch before removing an
  owned worktree without `--force`; keep uncertain or externally owned resources.
  An empty lease store does not certify the rest of the workstation clean.
