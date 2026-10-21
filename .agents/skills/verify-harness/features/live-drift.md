# Live drift

Merged source is only useful once deployed. This feature compares the live `~/.claude` and `~/.codex` guidance and skills with a composition from the installed revision. Then a fresh live Claude Code session quotes its global guidance through a real model call, and a fresh live Codex prompt is rendered.

## Sub-features

- `live-guidance`: live canonical AGENTS.md is regular, no legacy file or symlink exists, and live `~/.claude/AGENTS.md` and `~/.codex/AGENTS.md` are byte-identical to the composition.
- `live-skills`: the live skill directories each installer selects in both harnesses match source, ignoring `.harness-owned` markers.
- `live-claude-model`: the model quotes `# Claude Code global guidance` from its user-level instructions.
- `live-codex-prompt`: the live Codex prompt carries the composed AGENTS.md and the selected skills from `~/.codex/skills`.

## How to get to it (user POV)

- Open any new lane and expect it to follow current guidance and skills.

## Driving it with verify-harness

Preconditions:

- `verify-harness install origin/master` (what should be deployed) or `install` for HEAD passed in this `VH_DIR`.
- Doctor shows Claude Code signed in.

- **Compare files.** Run `verify-harness live`. Expect `PASS live ~/.claude/AGENTS.md matches source`, `PASS live ~/.codex/AGENTS.md matches source` and `PASS live ~/.claude and ~/.codex shared skills match source`.
- **Real Claude Code session.** In the same run, expect `PASS fresh Claude Code session received complete canonical AGENTS.md through native SessionStart`, `model answered: # Claude Code global guidance` and `PASS the model sees the live global guidance`.
- **Real Codex prompt.** In the same run, expect `PASS fresh Codex session prompt carries the composed AGENTS.md` and `PASS Codex skill root is /home/phaedrus/.codex/skills`.
- **Proof.** Keep `claude-live-*.json*`, `codex-live-summary.txt` and the live section of `transcript.txt`.

## Gotchas

- A DRIFT line against `origin/master` means merged guidance or skills were never deployed. Deploy through the component installer, then rerun `live`. A DRIFT line against a feature branch is expected while that branch changes guidance or skills.
- The live Claude Code session runs `--model haiku` with `HOME` set and `CLAUDE_CONFIG_DIR` unset, which is how a lane starts. It uses the owner's subscription, loads the live user settings and their hooks, and updates the runtime state any session does: a transcript under `~/.claude/projects/-tmp-verify-harness-cwd-*`, `~/.claude.json`, and Claude Code's synced-skill state under `~/.claude/skills/synced/`. The live Codex render leaves lock files under `~/.codex/tmp`.
- The model line proves only that the live user AGENTS.md reaches the model. Its heading is the same at every revision, so the `cmp` and `diff` lines carry the drift claim.
- The live Codex prompt also lists the operator's other skills under other roots. Only the selected skills under `r0` are asserted.
