# Live drift

Merged source is only useful once deployed. This feature compares the live `~/.claude` and `~/.codex` guidance and skills with a composition from the installed revision. Then a fresh live Claude Code session quotes its global guidance through a real model call, and a fresh live Codex prompt is rendered.

## Sub-features

- `live-guidance`: live `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` are byte-identical to the composition.
- `live-skills`: the nine live skill directories in both harnesses match source, ignoring `.harness-owned` markers.
- `live-claude-model`: the model quotes `# Claude Code global guidance` from its user-level instructions.
- `live-codex-prompt`: the live Codex prompt carries the composed AGENTS.md and the nine skills from `~/.codex/skills`.

## How to get to it (user POV)

- Open any new lane and expect it to follow current guidance and skills.

## Driving it with verify-harness

Preconditions:

- `verify-harness install origin/master` (what should be deployed) or `install` for HEAD passed in this `VH_DIR`.
- Doctor shows Claude Code signed in.

- **Compare files.** Run `verify-harness live`. Expect `PASS live ~/.claude/CLAUDE.md matches source`, `PASS live ~/.codex/AGENTS.md matches source` and `PASS live ~/.claude and ~/.codex shared skills match source`.
- **Real Claude Code session.** In the same run, expect `PASS fresh Claude Code session loaded user guidance /home/phaedrus/.claude/CLAUDE.md`, `model answered: # Claude Code global guidance` and `PASS the model sees the live global guidance`.
- **Real Codex prompt.** In the same run, expect `PASS fresh Codex session prompt carries the composed AGENTS.md` and `PASS Codex skill root is /home/phaedrus/.codex/skills`.
- **Proof.** Keep `claude-live-*.json*`, `codex-live-summary.txt` and the live section of `transcript.txt`.

## Gotchas

- A DRIFT line against `origin/master` means merged guidance or skills were never deployed. Deploy through the component installer, then rerun `live`. A DRIFT line against a feature branch is expected while that branch changes guidance or skills.
- The live Claude Code session runs `--model haiku`, uses the owner's subscription, and leaves a transcript under `~/.claude/projects/-tmp-verify-harness-cwd-*`. It also loads the live user settings and their hooks.
- The live Codex prompt also lists the operator's other skills under other roots. Only the nine under `r0` are asserted.
