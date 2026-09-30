# Fleet wiring

Reuse the deployed engine or existing OpenRouter Decisions path.

- `OPENROUTER_API_KEY` is preferred and required by Hermes plugins.
- Pin `typesafe/jev-1.13` until an evaluation on our cases supports a bump.
- `TYPESAFE_API_KEY` is the harness engine's direct-API fallback, not Hermes auth.
- Timeout, 429, or 5xx leaves a usable default; missing keys means disabled,
  not fabricated scores.

## Hermes

`jev-checks` and `jev-skill-suggest` advise; Hermes decides. They append one line,
not replacement tool results. Nested Hermes children skip them; kanban workers
do not. Their operating skills own their procedures. No Jev label auto-loads a
skill, vetoes a tool, merges, or sends. Glance catalog-layout selection belongs
to `json-render-jev`.

## OMP / Pi diff review

`agent-config/system-one/engine.ts` deploys into the `diff-review` extensions.
Use `/diff-review [taste|security]`, or from the harness checkout:

```sh
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --staged
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --battery security
```

Engine policy owns blocks/confidence thresholds and chunking; the deployed path,
not a copied client or `npx skills add typesafe-ai/skills`, is authoritative.
Keep secrets out of judgment state.
