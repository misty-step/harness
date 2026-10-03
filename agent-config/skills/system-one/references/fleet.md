# Fleet wiring

Reuse the deployed engine or existing OpenRouter Decisions path.

- Harness OMP/Pi calls use `OPENROUTER_API_KEY`; bind the project's `.env.pass`
  with `pass-env run -f .env.pass -- COMMAND`.
- Hermes credentials and consumers belong to
  [`hermes-config`](https://github.com/misty-step/hermes-config): follow its
  names-only `.env.pass` and profile configuration, not OMP's chat environment.
- Send `POST https://openrouter.ai/api/alpha/decisions` with Bearer auth,
  `model: "typesafe/jev-1.13"`, `state`, and typed `questions`. The response
  supplies `answers`, resolved `model`, and token `usage`; inspect current
  [OpenRouter Jev docs](https://openrouter.ai/docs/guides/community/jev) and
  the deployed client before changing fields.
- Pin `typesafe/jev-1.13` until an evaluation on our cases supports a bump.
- Upstream SDK examples target TypeSafe directly; do not use that endpoint or
  `TYPESAFE_API_KEY` for fleet calls.
- Timeout, 429, or 5xx leaves a usable default; missing keys means disabled,
  not fabricated scores.

## Hermes

The Kaylee distribution installs the same official `typesafe-ai` package through
its owned skills directory. Its repository owns Hermes-specific Jev procedures
and authentication; do not infer them from retired plugins or copy OMP wiring.
Jev advises on semantic decisions; Hermes/code retain execution and side effects.

## Diff review

`agent-config/system-one/engine.ts` deploys into Pi's `diff-review` extension.
Pi supports `/diff-review [taste|security]`. OMP's automatic turn-end extension
is retired; explicit CLI review remains available from the harness checkout:

```sh
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --staged
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --battery security
```

Engine policy owns blocks/confidence thresholds and chunking. The official
`typesafe-ai` skill owns judgment design, not fleet transport or authentication.
Keep secrets out of judgment state.
