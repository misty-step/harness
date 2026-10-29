---
name: principle-attack-the-premise
description: "Two or more fixes on one premise failed the same check: test the premise before the next fix."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Repeated failed fixes on a false belief; Scholar pstack adoption."
  source: "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-attack-the-premise; Daybook artifacts/2026-10/pstack-vs-mistystack.md (Scholar); Phaedrus t2228u via Maren"
  sunset: "2026-11-27"
---

# Attack the premise

When two fixes that share one premise fail the same check, suspect the premise, not the fixes.

Write the premise as the one sentence every failed fix assumed. Before the next fix, make an observation that would come out differently if it were false; look at how failures are distributed, not only their size.

If the evidence contradicts the premise, find what the failures share that it did not predict. If it confirms the premise, ask the next why with the `principle-fix-root-causes` skill.

Remove the condition rather than compensating for it; a cleanup mechanism leaves the cause and adds work every run.

Done when the premise is written down and tested before another fix starts.
