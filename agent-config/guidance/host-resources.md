## Host resources

Desktop RAM is shared with the operator.

- **exe.dev mandate:** Heavy execution an agent starts from this workstation (multi-worker suites, full coverage, browser/Electron verification, and long-running services) MUST run in the project's owned exe.dev workspace through `ws` (`skill://using-exe-dev`). CI jobs on GitHub-hosted runners, including required browser story walks, are exempt from this desktop-protection rule (operator decision 2026-09-25). Standing operator approval (2026-09-25) covers one owned `<project>-ws` VM per project within the current $40 exe.dev plan; any other VM requires separate approval. Agent sessions and model credentials remain local until a separate operator decision. Bounded checks with an explicit low concurrency cap (such as `./scripts/verify`), local desktop/GPU work, and data-constrained tasks may run locally.
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
