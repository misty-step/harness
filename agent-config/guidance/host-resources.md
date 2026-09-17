## Host resources

Desktop RAM is shared with the operator.

- **exe.dev mandate:** Heavy execution (multi-worker suites, full coverage, browser/Electron verification, and long-running services) MUST run off-host in an approved isolated persistent workspace on exe.dev (`skill://using-exe-dev`). Bounded checks with an explicit low concurrency cap (such as `./scripts/verify`), local desktop/GPU work, and data-constrained tasks may run locally.
- **Runner budgets:** When running bounded checks locally, cap runner concurrency in repo config, never the host default.
- **Scratch directory:** Always use run-scoped `TMPDIR` under `~/.cache/tmp`, never `/tmp` (RAM tmpfs). Clean up on exit.
- **Fleet hygiene:** Check for existing runs before starting one; stop only processes owned by this session.
