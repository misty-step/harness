# claude-config

Claude Code consumer of the shared primitives in `agent-config`. Every T3 lane
runs Claude Code, so the skills and guidance lanes and Home use deploy here.

| Selected | Why |
| --- | --- |
| `lage` | Home's executive brief across every lane |
| `ship-loop` | A lane's conductor: builder, QA, reviewer and judge rounds, merge, release watch |
| `judge` | Product-owner ruling on findings: blocker, file or skip |
| `release-watch` | Post-merge health, restore, incident and postmortem triggers |
| `heartbeat` | The sweep that keeps lanes moving |
| `story-qa`, `user-stories`, `pokayoke`, `authenticated-commands` | Existing shared skills the loop calls |
| Guidance `engineering`, `workstation`, `autonomy` | Foundations pointer, workstation facts, the standing autonomy policy |
| `t3-pool` | Continue usage-limited T3 threads on another account every 90 seconds ([contract](../agent-config/t3-pool/README.md)) |

```sh
./install          # deploys to $CLAUDE_CONFIG_DIR, default ~/.claude
```

`~/.claude/skills` also holds symlinks the `skills` CLI manages for upstream
packs (`mattpocock/skills`, `cursor/plugins` pstack). The installer
clean-replaces only the skill directories it selects. Guidance lands in
`~/.claude/AGENTS.md`, with no `CLAUDE.md` file or symlink. Native loading
is a separate verification step on the installed Claude Code version. The content file is owned (first line is the ownership marker); a foreign one stops the install
before any write.

The installer also deploys the shared pool CLI, its owned config and user units,
leaving timer activation opt-in. Reinstall preserves enabled, disabled and masked
states. Hosts without a systemd user manager skip pooling with a notice. Pool
state and logs survive reinstalls. A foreign pool launcher, config or unit stops
preflight before any selected file changes. See the [pool contract](../agent-config/t3-pool/README.md)
for activation and the durable off switch.

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
