# claude-config

Own what Claude Code sessions select from `../agent-config`; T3 lanes run on
Claude Code. `./install` deploys to `$CLAUDE_CONFIG_DIR` (default `~/.claude`):
selected skills, plus `global/CLAUDE.md` composed with shared guidance into
`~/.claude/CLAUDE.md`, the user-scope file every session loads. An `AGENTS.md`
there would load only in projects without a `CLAUDE.md` (Claude Code 2.1.303
loader), so it is not used. A foreign `~/.claude/CLAUDE.md` stops the install.
`settings.json` gains only the owned `.env` read-deny rules; foreign keys and
rules stay.
Third-party packs (Pocock, pstack) stay with the `skills` CLI.

Run `../scripts/check shared`, which includes this installer's committed-HEAD check.
