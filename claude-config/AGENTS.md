# claude-config

Own what Claude Code sessions select from `../agent-config`; T3 lanes run on
Claude Code. `./install` deploys to `$CLAUDE_CONFIG_DIR` (default `~/.claude`):
selected skills, plus `global/AGENTS.md` composed with shared guidance into
`~/.claude/AGENTS.md`. Native loading must be proved on the installed version
with `verify-harness`; successful installation alone is not proof. The owned
SessionStart adapter in user settings reads this canonical file for native CLI
and T3 SDK sessions, including outside HOME, and the workstation-guard `PreToolUse` hook for `Bash` (idempotent; a foreign entry at its command stops the install). Preserve foreign hooks and settings. No `CLAUDE.md`
file or symlink is created. Foreign instructions or unrelated links stop the
install before writes. Owned standalone legacy content is preserved at
`.harness-instruction-migration/AGENTS.md` before its old entry is removed.
Owned aliases to canonical AGENTS.md are removed. Broken aliases are refused
because ownership cannot be proved.
Third-party packs (Pocock, pstack) stay with the `skills` CLI.

Run `../scripts/check shared`, which includes this installer's committed-HEAD check.
