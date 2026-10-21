# Fresh session

The deploy only matters if a fresh session loads it. A new Claude Code session must load `CLAUDE_CONFIG_DIR/CLAUDE.md` as its user instructions and list the skills claude-config selects. A new Codex session's model-visible prompt must contain the composed AGENTS.md and list the skills from `CODEX_HOME/skills`.

## Sub-features

- `session-claude-guidance`: Claude Code fires `InstructionsLoaded` for the deployed CLAUDE.md as `memory_type: User`, and for no other file.
- `session-claude-skills`: the Claude Code init event lists every skill `claude-config/install` selects (on 2026-10-21: `lage`, `ship-loop`, `judge`, `release-watch`, `heartbeat`, `lane-succession`, `story-qa`, `pokayoke`, `user-stories` and `authenticated-commands`).
- `session-codex-guidance`: Codex's rendered prompt contains `<!-- owned by misty-step/harness codex-config -->` and the composed sections.
- `session-codex-skills`: the prompt's skill root `r0` is the deployed `skills` directory, and it lists every skill `codex-config/install` selects.
- `session-repo-skill`: sessions started in a `/tmp` copy of the revision's `.claude` and `.agents` list this `verify-harness` skill: Claude Code from the `.claude/skills` symlink, and Codex from the copy's `.agents/skills` root.

## How to get to it (user POV)

- Start a new Claude Code session, or a new T3 lane on a Claude instance.
- Start a new Codex session, or a new T3 lane on a Codex instance.

## Driving it with verify-harness

Preconditions:

- `verify-harness install` passed in this `VH_DIR`.

- **Claude Code.** Run `verify-harness session claude`. Expect `PASS fresh Claude Code session loaded user guidance <run>/claude-home/.claude/CLAUDE.md`, `PASS no other instruction file leaked into the session` and `PASS Claude Code session lists every claude-config skill`. The model call line reads `Not logged in`, which is expected for a private HOME.
- **Codex.** Run `verify-harness session codex`. Expect `PASS fresh Codex session prompt carries the composed AGENTS.md`, `PASS Codex skill root is <run>/claude-home/.codex/skills` and `PASS Codex session lists every codex-config skill`.
- **Repository skill.** Run `verify-harness session` (both). Expect `PASS Claude Code lists verify-harness from the project .claude/skills symlink` and `PASS Codex lists verify-harness from the project .agents/skills`. A revision older than this skill fails here.
- **Proof.** Keep `claude-isolated-init.json`, `claude-isolated-instructions.jsonl`, `codex-isolated-summary.txt` and `registration-*`.

## Gotchas

- Claude Code walks every ancestor of its cwd for `CLAUDE.md` and `.claude/skills`. Started under `/home/phaedrus`, an isolated session also loads the live `~/.claude/CLAUDE.md`, as `memory_type: Project`, and every live skill. The helper uses a fresh `/tmp/verify-harness-cwd.*` cwd, and the leak check fails if any other instruction file appears.
- The isolated Claude Code session has no credentials, so the model never answers. The init event and hooks fire first, which is enough for the loading claim. The model-visible proof is in [Live drift](./live-drift.md).
- `codex debug prompt-input` needs no login and makes no model call. It warns that it cannot create PATH aliases under a temp dir; ignore that warning.
- Built-in Claude Code skills, such as `simplify` and `loop`, appear alongside the selected ones. Only the selected skills are asserted.
