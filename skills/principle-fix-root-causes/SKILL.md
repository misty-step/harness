---
name: principle-fix-root-causes
description: "Debugging or repeated failed fixes: test the premise, then fix the first wrong decision, not the place the symptom surfaced."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Symptom guards that hide faults; Scholar pstack adoption."
  source: "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-fix-root-causes; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-attack-the-premise; Daybook artifacts/2026-10/pstack-vs-mistystack.md (Scholar); Phaedrus t2228u via Maren"
  sunset: "2026-11-27"
---

# Fix root causes

The symptom is where a wrong state became visible; the root cause is the first place the system did what it should not, or failed to handle a state it should.

Reproduce first. Ask why until the answer is a wrong decision in code, not a consequence of an earlier one. When stuck, instrument and read the actual error and state.

If the triggering state is legitimate, handle it where it broke. If it should never exist, a check there hides the bug; find what produced it. Guards, retries, swallowed errors, clamped values and discarded state are the usual hiding places.

After two fixes on one premise fail the same check, write the premise down and test it with an observation that would differ if it were false before the next fix; if it is false, look for what the failures share that it did not predict.

Failing only after a restart points to persisted state: config, caches, lock files. Fix every instance of the pattern, not one. A workaround that needs a paragraph of justification means the code is wrong.

Done when the first wrong decision is removed and the original path passes.
