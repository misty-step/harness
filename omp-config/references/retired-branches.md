# Retired branches

Remote branches deleted 2026-09-16 after a portfolio triage. Two classes:

- **pre-rewrite** — no common ancestor with `master`; the histories are
  disjoint (branch commit count equals its unique count). These predate the
  harness rebuild and cannot be merged.
- **landed** — shares `master` history; the work reached `master` through a
  PR or squash, so the branch is superseded.

Tip SHAs are recorded for short-term recovery; GitHub may garbage-collect
unreachable objects.

| Branch | Tip | Last commit | Class |
| --- | --- | --- | --- |
| `chore/astra-harness-modernization` | `27d1241` | 2026-09-07 | landed |
| `feat/autoreview-omp-engine` | `79dbd3c` | 2026-08-07 | pre-rewrite |
| `feat/openrouter-routing-telemetry` | `8bbd19f` | 2026-08-11 | pre-rewrite |
| `fix/code-review-erase-prepare` | `fac6327` | 2026-08-07 | pre-rewrite |
| `fix/code-review-gate-alignment` | `b142c08` | 2026-08-07 | pre-rewrite |
| `fix/consol-skills-groom-foundation` | `5139cef` | 2026-08-07 | pre-rewrite |
| `fix/cull-compound-council-image-gen` | `24b2d2b` | 2026-08-07 | pre-rewrite |
| `fix/install-terminal-rig-surfaces` | `f0a330d` | 2026-08-07 | pre-rewrite |
| `fix/kill-aesthetic-cull-skills` | `b5ed4d0` | 2026-08-07 | pre-rewrite |
| `fix/slim-external-registry` | `794964b` | 2026-08-07 | pre-rewrite |
| `foundation/access-faces-doctrine` | `7e643e9` | 2026-08-07 | pre-rewrite |
| `refactor/lean-agent-instructions` | `683a3a7` | 2026-09-04 | landed |
| `rescue/stash-0` | `746a557` | 2026-07-24 | pre-rewrite |
| `sdlc/lean-delivery-gates` | `1d6da9b` | 2026-08-21 | landed |
| `skill/priorities` | `a7bd373` | 2026-08-17 | landed |
| `wip/stash-0-20260801` | `d0dddc7` | 2026-08-01 | pre-rewrite |
