# Isolated deploy

`claude-config/install` and `codex-config/install` compose the global guidance (`~/.claude/AGENTS.md`, `~/.codex/AGENTS.md`). They also deploy the shared skills each installer selects, and claude-config installs the `t3-pool` and `t3-runtime-mode` launchers. This feature runs them as the operator would, but into a private HOME.

## Sub-features

- `deploy-claude`: AGENTS.md is the harness intro with the engineering, workstation and autonomy sections spliced at the marker; the native SessionStart adapter, skills and launchers are in place, with no legacy entry.
- `deploy-codex`: AGENTS.md is composed the same way, and the skills are in place.
- `deploy-pool-opt-in`: install only reloads user units and never enables `t3-pool.timer`.
- `deploy-foreign-refusal`: an AGENTS.md or legacy entry without the harness ownership marker stops the install before any write.

## How to get to it (user POV)

- Run `claude-config/install` and `codex-config/install` with no arguments. Those are live writes to `~/.claude`, `~/.codex`, `~/.local/bin` and `~/.config/systemd/user`.
- Run `./install` for every harness.

## Driving it with verify-harness

Preconditions:

- The revision under test is committed, or name another with `install origin/master`.

- **Deploy.** Run `verify-harness install`. Expect `PASS claude-config/install exit 0` and `PASS codex-config/install exit 0`.
- **Check composition.** In the same output, expect `PASS ~/.claude/AGENTS.md is the composed guidance`, `PASS ~/.codex/AGENTS.md is the composed guidance` and `PASS claude skills (...) and codex skills (...) byte-identical to source`.
- **Canonical adapter.** Expect `PASS Claude uses AGENTS.md alone with no legacy alias`. Content is a regular AGENTS.md, with no legacy file or symlink. Shared checks exercise owned legacy upgrades, preserved backups, reruns and foreign/broken-link refusals. All fixtures author content as AGENTS.md.
- **Native settings.** Expect `PASS repeated native adapter install leaves settings byte-identical` and `PASS foreign native settings and startup hook preserved`. Fresh-session drives prove the preserved hook also runs.
- **Check the pool stays opt-in.** Expect `PASS t3-pool and t3-runtime-mode launchers` and `PASS pool timer left opt-in (only daemon-reload across both installs)`.
- **Refuse foreign files.** Expect `PASS claude install refuses a foreign AGENTS.md, nothing written` and `PASS codex install refuses a foreign AGENTS.md, nothing written`.
- **Proof.** Keep the install section of `transcript.txt` and `install-tree.txt`.

## Gotchas

- Redirecting only `CLAUDE_CONFIG_DIR` or `CODEX_HOME` still writes launchers and units into the real `~/.local/bin` and `~/.config`. The helper isolates `HOME` with `env -i`.
- A private HOME has no systemd user manager. The fixture `systemctl` records calls in `systemctl-calls` instead of making them.
- `install` deletes the previous run directory first, but only one carrying its `.verify-harness-run` marker. Use a distinct absolute `VH_DIR` for a parallel run.
- `install <rev>` fetches the commit itself into the private clone, so remote-tracking revisions such as `origin/master` work right after a fetch.
- Codex prefers `AGENTS.override.md` over `AGENTS.md`, and the installer only warns about it. [Fresh session](./fresh-session.md) catches an override because the rendered prompt would lack the composed file.
