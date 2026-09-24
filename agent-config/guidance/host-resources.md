## Host resources

Desktop RAM is shared with the operator.

- **exe.dev mandate:** Heavy execution (multi-worker suites, full coverage, browser/Electron verification, and long-running services) MUST run off-host in an approved isolated persistent workspace on exe.dev (`skill://using-exe-dev`). Bounded checks with an explicit low concurrency cap (such as `./scripts/verify`), local desktop/GPU work, and data-constrained tasks may run locally.
- **Runner budgets:** When running bounded checks locally, cap runner concurrency in repo config, never the host default.
- **Scratch directory:** Always use run-scoped `TMPDIR` under `~/.cache/tmp`, never `/tmp` (RAM tmpfs). Clean up on exit.
- **Fleet hygiene:** Check for existing runs and `git worktree list --porcelain`
  in the affected repository before creating another checkout. Keep one
  canonical checkout per repository: parallel writers use the harness's native
  isolated delegation where it exists, and a worktree is only for a separate
  top-level session that needs its own branch. Stop only processes owned by this
  session. `git worktree add` and `ssh exe.dev new` in-session take a
  `session-close.ts add` lease in the same turn; wrap is incomplete until
  `skill://session-close` exits 0. At completion, inspect Git-visible changes
  and the branch before `git worktree remove` (without `--force`); keep uncertain
  or externally owned resources. An empty lease store does not certify the rest
  of the workstation clean.
