# Fleet wiring

- Harness OMP/Pi calls use `OPENROUTER_API_KEY`; bind the project's `.env.pass`
  with `pass-env run -f .env.pass -- COMMAND`.
- `POST https://openrouter.ai/api/alpha/decisions` with Bearer auth,
  `model: "typesafe/jev-1.13"`, `state`, and typed `questions` returns `answers`,
  the resolved `model` and token `usage`. Check current
  [OpenRouter Jev docs](https://openrouter.ai/docs/guides/community/jev) and the
  deployed client before changing fields.
- Keep `typesafe/jev-1.13` pinned until an evaluation on our cases supports a bump.
- Timeout, 429 or 5xx leaves a usable default; a missing key means disabled, not
  fabricated scores.
- Hermes/Kaylee credentials and Jev procedures belong to
  [`hermes-config`](https://github.com/misty-step/hermes-config); do not copy OMP
  wiring there.

## Diff review

`agent-config/system-one/engine.ts` deploys into Pi's `diff-review` extension
(`/diff-review [taste|security]`); engine policy owns thresholds and chunking.
OMP's turn-end review is retired; explicit CLI review remains:

```sh
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts [--staged] [--battery security]
```
