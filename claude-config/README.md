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

```sh
./install          # deploys to $CLAUDE_CONFIG_DIR, default ~/.claude
```

`~/.claude/skills` also holds symlinks the `skills` CLI manages for upstream
packs (`mattpocock/skills`, `cursor/plugins` pstack). The installer
clean-replaces only the skill directories it selects. Guidance lands in
`~/.claude/CLAUDE.md`, which Claude Code loads in every project. The file is
owned (first line is the ownership marker); a foreign one stops the install
before any write.
