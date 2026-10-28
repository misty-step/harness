# codex-config

Codex consumer of the shared primitives in `agent-config`, plus native Codex
defaults. Heavy lifting routes to GPT-6.1 Sol on Codex, so its sessions load
the same skills and policy Claude Code lanes do.

| Selected | Why |
| --- | --- |
| `lage`, `ship-loop`, `judge`, `release-watch`, `heartbeat` | Same lane workflow skills as `claude-config` |
| `story-qa`, `user-stories`, `pokayoke`, `authenticated-commands` | Existing shared skills the loop calls |
| Guidance `engineering`, `workstation`, `autonomy` | Foundations pointer, workstation facts, the standing autonomy policy |

```sh
./install          # deploys to $CODEX_HOME, default ~/.codex
```

Codex 0.163 loads `$CODEX_HOME/AGENTS.md` as global instructions (an
`AGENTS.override.md` there replaces it; the installer warns) and user skills
from `$CODEX_HOME/skills`. The installer marks the skill packages it deploys
with `.harness-owned` and clean-replaces only marked directories. An unmarked
selected package or symlink stops the install with a warning before any write.
Bundled `skills/.system`, other linked skills and unowned retired packages
stay untouched. `~/.codex/AGENTS.md` is owned (first line is the ownership
marker); a foreign file or any symlink stops the install before any write.

The installer also registers the workstation guard in `$CODEX_HOME/hooks.json`
(foreign hooks kept) and trusts it through Codex's own `config/batchWrite`
RPC, because Codex skips untrusted hooks; without `codex` on `PATH` it warns
and the hook needs trusting with `/hooks`. `config.toml` is source for four
native defaults only and is otherwise not deployed by this installer; see the root README's
[Codex defaults](../README.md#codex-defaults-native-installation).
