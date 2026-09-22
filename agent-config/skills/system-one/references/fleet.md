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

## Do not

- Install `npx skills add typesafe-ai/skills` as a replacement for this package.
- Treat TypeSafe cookbook guardrails as a Hermes permission gate.
- Send secrets in `state`.
