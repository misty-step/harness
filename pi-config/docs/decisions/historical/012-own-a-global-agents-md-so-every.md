# ADR-012: Own a global `AGENTS.md` so every pi session carries the shared conventions

Accepted 2026-09-15.

Pi loads `~/.pi/agent/AGENTS.md` into
every session in every repository — the one hook that reaches every pi agent
everywhere — but on this machine it did not exist, so a session in a
repository without its own `AGENTS.md` (such as this repo) never saw the
pokayoke convention that the README and `install` already name. The omp
harness ships the matching conventions through `omp-config`'s
`global/AGENTS.md`; this is the pi counterpart, scoped to what is universal to
the operator rather than to one harness's model routing or trackers. We own
`global/AGENTS.md` here and `./install` deploys it to
`~/.pi/agent/AGENTS.md` (ledger row, allowlisted in `.gitignore`). Alternative
(edit the live file directly) rejected: no source of truth, and the file would
drift or be silently clobbered by the next install — the same error class
ADR-001 already closed for settings.
