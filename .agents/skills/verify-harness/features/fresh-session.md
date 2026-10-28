# Fresh session

The deploy only matters if a fresh session loads it. A new Claude Code session must receive canonical `CLAUDE_CONFIG_DIR/AGENTS.md` through the installed native SessionStart adapter, with no legacy file or symlink and list the skills claude-config selects. A new Codex session's model-visible prompt must contain the composed AGENTS.md and list the skills from `CODEX_HOME/skills`.

## Sub-features

- `session-claude-guidance`: Claude Code emits native SessionStart responses whose complete text equals deployed AGENTS.md. No other instruction file leaks in.
- `session-claude-skills`: the Claude Code init event lists every skill `claude-config/install` selects.
- `session-codex-guidance`: Codex's rendered prompt contains `<!-- owned by misty-step/harness codex-config -->` and the composed sections.
- `session-codex-skills`: the prompt's skill root `r0` is the deployed `skills` directory, and it lists every skill `codex-config/install` selects.
- `session-repo-skill`: sessions started in a `/tmp` copy of the revision's `.claude` and `.agents` list this `verify-harness` skill: Claude Code from the `.claude/skills` symlink, and Codex from the copy's `.agents/skills` root.

## How to get to it (user POV)

- Start a new Claude Code session.
- Start a new Codex session.

## Driving it with verify-harness

Preconditions:

- Record the actual installed Claude Code version. The proof uses AGENTS.md alone and creates no legacy aliases. A private newer-version comparison is separate evidence.

- `verify-harness install` passed in this `VH_DIR`.

- **Claude Code.** Run `verify-harness session claude`. Expect `PASS fresh Claude Code session received complete canonical AGENTS.md through native SessionStart`, `PASS no other instruction file leaked into the session` and `PASS Claude Code session lists every claude-config skill`. The model call line reads `Not logged in`, which is expected for a private HOME.
- **Codex.** Run `verify-harness session codex`. Expect `PASS fresh Codex session prompt carries the composed AGENTS.md`, `PASS Codex skill root is <run>/claude-home/.codex/skills` and `PASS Codex session lists every codex-config skill`.
- **Repository skill.** Run `verify-harness session` (both). Expect `PASS Claude Code lists verify-harness from the project .claude/skills symlink` and `PASS Codex lists verify-harness from the project .agents/skills`. A revision older than this skill fails here.
- **Authenticated candidate.** Run `verify-harness session-auth` to prove the model reads the newly installed canonical and QA policy using native CLI subscription authentication in the isolated HOME. Expect `PASS authenticated fresh Claude model read canonical instructions and QA policy`. The private credential copy is removed; no product account or live deployment changes.
- **Proof.** Keep `claude-isolated-init.json`, `claude-isolated-instructions.jsonl`, `codex-isolated-summary.txt` and `registration-*`.

## Gotchas

- Claude Code walks every ancestor of its cwd for `AGENTS.md` and `.claude/skills`. Started under `/home/phaedrus`, an isolated session also loads the live `~/.claude/AGENTS.md`, as `memory_type: Project`, and every live skill. The helper uses a fresh `/tmp/verify-harness-cwd.*` cwd, and the leak check fails if any other instruction file appears.
- The isolated Claude Code session has no credentials, so the model never answers. The init event and hooks fire first, which is enough for the loading claim. The model-visible proof is in [Live drift](./live-drift.md).
- `codex debug prompt-input` needs no login and makes no model call. It warns that it cannot create PATH aliases under a temp dir; ignore that warning.
- Built-in Claude Code skills, such as `simplify` and `loop`, appear alongside the selected ones. Only the selected skills are asserted.

- Native 2.1.303 and a private native 2.1.305 comparison did not load user-scope AGENTS.md from the isolated cwd outside HOME. The model returned MISSING_POLICY. The maintained SessionStart adapter is the integration for that missing global discovery path. The old failure is retained in evidence; an ancestor-based project load alone remains insufficient.
