# claude-config

Own what Claude Code sessions select from `../agent-config`; T3 lanes run on
Claude Code. `./install` deploys to `$CLAUDE_CONFIG_DIR` (default `~/.claude`):
selected skills, plus `global/AGENTS.md` composed with shared guidance into
`~/.claude/AGENTS.md`. `~/.claude/CLAUDE.md` is a relative compatibility
symlink to it, which Claude Code loads at user scope in every project. Foreign
instructions or noncanonical links stop installation before writes. An owned
standalone legacy file is preserved at `.harness-instruction-migration/AGENTS.md`
before the owned adapter replaces its entry with the compatibility symlink.
Third-party packs (Pocock, pstack) stay with the `skills` CLI.

Run `../scripts/check shared`, which includes this installer's committed-HEAD check.
