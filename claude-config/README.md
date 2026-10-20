# claude-config

Claude Code consumer of the shared primitives in `agent-config`. Every T3 lane
runs Claude Code, so skills that lanes and Home use deploy here.

| Selected | Why |
| --- | --- |
| `lage` | Home's executive brief across every lane |

```sh
./install          # deploys to $CLAUDE_CONFIG_DIR, default ~/.claude
```

`~/.claude/skills` also holds symlinks the `skills` CLI manages for upstream
packs (`mattpocock/skills`, `cursor/plugins` pstack). The installer
clean-replaces only the skill directories it selects.
