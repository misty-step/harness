---
name: principle-explain-the-number
description: "Producing or trusting a performance, eval or other measured number: name the decision, the limiter and the noise before claiming it."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "False measured claims; Scholar pstack adoption (explain-the-number plus benchmark-checklist)."
  source: "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-explain-the-number; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/benchmark-checklist; Daybook artifacts/2026-10/pstack-vs-mistystack.md (Scholar); Phaedrus t2228u via Maren"
  sunset: "2026-11-27"
---

# Explain the number

Before running, write the claim you would ship and the result that would change a decision. Measure run-to-run spread before trusting an effect.

For performance numbers, ask why not double: name the limiter (a core, lock, disk, network or the load generator) from a profile or counters taken during a run, not from reading code.

Rule out what else the number could be: errors or fast rejections, cached or skipped work, code that never ran, an untuned side on defaults, noise, or a piece too small to matter end to end. Check arithmetic against hardware limits; removing a piece that takes 10% of a run makes it at most about 11% faster.

For a comparison, run production-tuned sides at least 5 times each, alternating, and report median, range and an uncertainty interval for the difference. Call it no measurable difference only when that interval includes zero. Before a repeated perf loop, freeze a harness that prints error and work counts.

Report the verdict first, then the number with unit, run count, range and limiter. A performance number missing its limiter, an untuned side or unchecked errors makes it inconclusive.

Done when the number carries its run count, spread and, for performance, named limiter.
