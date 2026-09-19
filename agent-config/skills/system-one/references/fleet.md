# Fleet wiring

Do not paste a new HTTP client. Use the deployed engine or the existing
OpenRouter Decisions call.

## Auth and model

- Prefer `OPENROUTER_API_KEY`. Hermes plugins require it.
- Pin `typesafe/jev-1.13` until an eval on our cases says to bump.
- `TYPESAFE_API_KEY` is the harness engine's direct-API fallback, not a Hermes plugin credential.
- On timeout, 429, or 5xx: fail open. An outage must not stop work.

## Hermes coprocessor

`jev-checks` and `jev-skill-suggest` are advisory. Hermes still decides.

- Do not register Jev on `pre_tool_call`.
- Do not veto tools, auto-merge, auto-send, or auto-load a skill from a Jev label.
- Append or inject one line. Do not replace tool results.
- Nested Hermes children still skip; kanban workers do not.
- Operating those plugins is `jev-checks` / `jev-skill-suggest`, not this skill.

Glance UI that picks a layout from a catalog is `json-render-jev`.

## Harness diff review (OMP / Pi)

`agent-config/system-one/engine.ts` deploys into each harness's `diff-review`
extension.

- Missing both keys: report disabled. Do not fabricate scores. Do not fail the turn.
- Active credential, unmasked disk secret, or authority escalation in a diff: hard block (US-005).
- Taste, strategy, pokayoke, verification: block only when probability clears the threshold **and** confidence ≥ 0.70. Otherwise warn.
- Untracked files are in scope unless explicitly disabled. Oversize diffs chunk by file/hunk in parallel.

```sh
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --staged
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --battery security
```

In OMP or Pi: `/diff-review`, `/diff-review taste`, `/diff-review security`.

## Compact advice (turn boundary)

`agent-config/system-one/compact.ts` is the shared compact judge. It asks two
one-sentence questions in one request (`done` × `shape`) and composes one score
in code; the hint floor slides from 0.90 (≤10% used) to 0.50 (≥90% used). The
question wording and the curve are adopted from kunchenguid/compact-adviser
(MIT), which hill-climbed them against labeled checkpoints. Do not reword the
questions casually; retune the floor constants instead.

Host policy:

- **Pi**: `extensions/compact-hint/` (ADR-023 in pi-config). Hint-only by
  default; automatic compaction only with `PI_COMPACT_HINT_AUTO=1` in a tui
  session. Print and JSON runs are inert; RPC stays hint-only.
- **Hermes**: no second plugin. The jev-checks `turn` battery carries
  `next=compact`; the advisory line reports it when the choice wins.
- **Codex**: hint-only. Nothing outside a Codex session can trigger
  `/compact`, so there is no auto mode.
- **OMP**: not wired yet; the judge is shared so the OMP extension surface can
  consume it without a copy.

Local gates run before any call: `COMPACT_ADVISER_DISABLE`, under 40k tokens,
unknown usage, and a cooldown. Fail open: a provider error, a missing key, or
an unusable answer is silence — never a hint, never compaction.

## Child verdict (`jev-verdict`)

`agent-config/bin/jev-verdict.ts` is the post-run judgment from the
pi-subagents `gate:` pattern, without the package. It reads one child summary
(stdin, `--file`, or `--text`), asks three atomic questions (`complete`,
`overclaim`, `blocker`), and prints one JSON line:
`{"verdict":"pass"|"fail"|"uncertain",...}`. Exit 0 for every judgment (2 only
for CLI misuse). It is advisory: not a merge oracle, not a permission gate,
and not a substitute for a reviewer. If pi-subagents is ever enabled, point
`gate:` at this command and record its output as evidence.

```sh
pass-env run -f .env.pass -- jev-verdict --file child-summary.md
cat child-summary.md | pass-env run -f .env.pass -- jev-verdict
```

## Do not

- Install `npx skills add typesafe-ai/skills` as a replacement for this package.
- Treat TypeSafe cookbook guardrails as a Hermes permission gate.
- Send secrets in `state`.
- Treat a compact hint as permission to drop context unread, or auto-compact
  in an unattended session.
- Treat `jev-verdict` output as a merge decision, or wire it as a failing gate.
