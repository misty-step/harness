# claude-config

Own what Claude Code sessions select from `../agent-config`; T3 lanes run on
Claude Code. `./install` deploys to `$CLAUDE_CONFIG_DIR` (default `~/.claude`):
selected skills, plus `global/AGENTS.md` composed with shared guidance into
`AGENTS.md`. Claude Code loads `~/.claude/AGENTS.md` natively (probed
2026-10-20), so the installer leaves `CLAUDE.md` alone.
Third-party packs (Pocock, pstack) stay with the `skills` CLI.

Run `../scripts/check shared`, which includes this installer's committed-HEAD check.
