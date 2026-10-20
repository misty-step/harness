# codex-config

Own Codex's native defaults (`config.toml`) and what Codex sessions select from
`../agent-config`. `./install` deploys to `$CODEX_HOME` (default `~/.codex`):
selected skills into `skills/`, plus `global/AGENTS.md` composed with shared
guidance into `~/.codex/AGENTS.md`, the global instructions every Codex session
loads. A foreign `~/.codex/AGENTS.md` stops the install. The installer never
writes `config.toml`; its four keys are applied through Codex's native
`config/batchWrite` (root README). Bundled `skills/.system` and linked skills
are left alone.

Run `../scripts/check shared`, which includes this installer's committed-HEAD check.
