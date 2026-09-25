# ADR-022: Bridge pi's model catalog to the live OpenRouter list

Accepted 2026-09-16.

Recorded 2026-09-25 from commit 7590ad2, which cited this record in
`pi-config/README.md` and `pi-config/AGENTS.md` without writing it; the
reasoning below is that commit's.

pi refreshes its catalog from a `pi.dev` mirror on a 4-hour ETag cycle, so a new
OpenRouter model lands in omp, which queries `openrouter.ai` directly, within
minutes but in pi hours later. Incident: OpenRouter model 091 on 2026-09-16
(stealth/union-alpha was visible in omp and absent from pi for hours).

`extensions/openrouter-live/` folds the live public list into the `models.json`
user overlay, additive only and fail-closed: a background refresh at session
start at most every 2 hours, plus `/models-live` on demand. It refuses to act on
an implausibly small catalog and never rewrites or removes entries, so it cleans
itself up as `pi.dev` catches up, and removing it restores stock behavior.
