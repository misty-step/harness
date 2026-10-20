# claude-config

Own what Claude Code sessions select from `../agent-config`; T3 lanes run on
Claude Code. `./install` deploys to `$CLAUDE_CONFIG_DIR` (default `~/.claude`)
and never touches foreign skills, settings or sessions. Third-party packs
(Pocock, pstack) stay with the `skills` CLI.

Run `../scripts/check shared`, which includes this installer's committed-HEAD check.
