# claude-config

Claude Code consumer of the shared primitives in `agent-config`.

| Selected | Why |
| --- | --- |
| `lage` | Executive brief across current work |
| `ship-loop` | A lane's conductor: builder, QA, reviewer and judge rounds, merge, release watch |
| `judge` | Product-owner ruling on findings: blocker, file or skip |
| `release-watch` | Post-merge health, restore, incident and postmortem triggers |
| `heartbeat` | The sweep that keeps lanes moving |
| `story-qa`, `user-stories`, `pokayoke`, `authenticated-commands` | Existing shared skills the loop calls |
| Guidance `engineering`, `workstation`, `autonomy` | Foundations pointer, workstation facts, the standing autonomy policy |

```sh
./install          # deploys to $CLAUDE_CONFIG_DIR, default ~/.claude
```

`~/.claude/skills` also holds symlinks the `skills` CLI manages for upstream
packs (`mattpocock/skills`, `cursor/plugins` pstack). The installer
clean-replaces only the skill directories it selects. Guidance lands in
`~/.claude/AGENTS.md`, with no `CLAUDE.md` file or symlink. Native loading
is a separate verification step on the installed Claude Code version. The content file is owned (first line is the ownership marker); a foreign one stops the install
before any write.

Upgrades accept only a first-line harness ownership marker on regular instruction
files. Foreign content, directories and unrelated or broken symlinks are refused.
An owned alias to canonical AGENTS.md is removed. A broken alias is refused
because ownership cannot be proved.
Owned standalone legacy content is retained, byte for byte, at
`~/.claude/.harness-instruction-migration/AGENTS.md` before its legacy entry is removed. Repeated
installs preserve that backup; a conflicting backup stops the upgrade.

An existing `AGENTS.md` link to an owned standalone legacy file is supported.
Migration snapshots all legacy bytes before removing that link or the legacy entry.
Foreign reverse links and conflicting backups stop the install without writes.

## Native startup

Claude's automatic AGENTS discovery follows project ancestors. It does not load
user-scope `~/.claude/AGENTS.md` from a cwd outside HOME on the native versions
probed here. The installer adds a native `SessionStart` hook in user settings,
The adapter reads the
canonical file on startup, resume, clear and compaction. It passes the complete
text in bounded parts, below Claude's hook-output limit, without another
instruction-content file or a shell launcher wrapper.

The installer owns `hooks/harness-agents.py` and only its own SessionStart
handlers. It preserves foreign settings, file mode, hooks and their order,
refuses malformed settings or unowned handler collisions before shared install
writes, and updates the owned handlers without duplicates on rerun. Explicit
`disableAllHooks`, safe mode or settings-source exclusions still take effect.

References: [AGENTS discovery](https://code.claude.com/docs/en/memory#when-claude-code-reads-agentsmd),
[native hook context and limits](https://code.claude.com/docs/en/hooks#add-context-for-claude).
