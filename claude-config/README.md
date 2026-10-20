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
| `--deny-env-reads` | `permissions.deny` rules so sessions can't read `.env` values (#351) |

```sh
./install          # deploys to $CLAUDE_CONFIG_DIR, default ~/.claude
```

`~/.claude/skills` also holds symlinks the `skills` CLI manages for upstream
packs (`mattpocock/skills`, `cursor/plugins` pstack). The installer
clean-replaces only the skill directories it selects. Guidance lands in
`~/.claude/CLAUDE.md`, which Claude Code loads in every project. The file is
owned (first line is the ownership marker); a foreign one stops the install
before any write.

`~/.claude/settings.json` gains the `.env` read denial at the head of
`permissions.deny`; other keys and rules stay, and a rerun adds nothing.
Secrets reach sessions through `pass-env` and native logins instead.

| Rule | Effect |
| --- | --- |
| `Read(//**/.env)`, `Read(//**/.env.local)`, `Read(//**/.env.*.local)` | `.env` and local overrides, in any project |
| `Read(.env.*)` | `.env.production` and every other variant, at or under the session directory |
| `Read(!.env.example)`, `Read(!.env.pass)`, `Read(!.env.pass.example)` | Stay readable: they hold references, not values |

Claude Code 2.1.303 applies these to its file tools and to simple Bash commands
that name the file (`cat .env`, `grep KEY .env`, `head`, `< .env`), even with
permissions bypassed. They don't reach recursive searches (`grep -r KEY .`,
`rg --hidden`), wrappers that hide the read (`bash -c 'cat .env'`, `. ./.env`,
`xargs cat`), a script that opens the file itself (`python3 -c ...`), or a
variant such as `.env.production` outside the session directory (a `!`
carve-out can't apply to an absolute rule). Only Claude Code's OS sandbox
closes those; #363 tracks it.
