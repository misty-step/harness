---
name: jev-qa-walk
description: Walk USER_STORIES in a browser via Jev decisions.
disable-model-invocation: true
argument-hint: "[optional URL, story id, or repo]"
---

# Jev QA walk

The class of error: a generative agent writes an essay about a walk, or a
model's DONE is treated as a pass. Neither is evidence.

The mechanism is one fail-closed CLI. Jev classifies the next step; code owns
the pass bit. Pass is a code postcondition. Jev never merges.

This walks an isolated candidate. It does not stand one up, does not touch
production, and does not replace a repository's existing `qa:agent`,
`qa:agentic`, or `qa_gate.py` entry point — it is the driver those call.

## Annotate, then run

Each criterion carries a postcondition a check can fail on, as an HTML comment
under the numbered criterion:

```markdown
1. WHEN I select Habitat, THE SYSTEM SHALL show the Habitat desk.
   <!-- walk: path=/habitat.html; text=Habitat desk -->
```

Clauses join with `;` and all must hold: `path=` (URL path, `*` glob), `text=`
(visible text substring), `heading=` (heading substring). A criterion without
an annotation is a defect; the CLI exits 2 rather than guess.

```sh
python3 scripts/walk.py --url URL --stories USER_STORIES.md \
  [--id US-XXX] [--trace PATH] [--provider mock|jev]
```

`jev` (default) needs `OPENROUTER_API_KEY` and one fat battery per step. The
walker observes first: if the postcondition already holds, Jev is skipped (L0).

- exit 0 — every selected criterion met by code postcondition
- exit 1 — fail_criterion, blocked, landed_wrong, lie, step limit
- exit 2 — bad args, no key, provider failure, missing mock fixture
- exit 3 — needs_vision, ESCALATE, unresolved or dead-heat click

Exit 3 is not a pass. Escalate once — `vision_analyze` for pixels, or a bounded
generative agent (max 3 actions) — then re-run this CLI. The CLI holds no
generative SDK. Record the story id, exit code, and trace with the change.

## Pitfalls

- Jev DONE is a candidate. Exit 0 comes only from code postconditions; a DONE
  the code disproves is exit 1 (`lie`).
- Do not add an operation-confidence floor. Navigation is low stakes; a correct
  click at 0.67 confidence must act. Pass/fail and vision are not low stakes.
- One battery per step, no `Score`-region calls. Extra questions are free;
  extra region calls are not.
- Advisory heads never gate. `copy_lie`, `qa_severity`, `empty_state`, and
  `overlay_trap` are recorded for the report, not stops.
- `--provider mock` replays a recorded answers fixture (`WALK_MOCK_FIXTURE`, or
  `walk-mock.json` beside the stories file). It is the offline and CI path, not
  a semantic judge; tests never call OpenRouter.
- This slice follows links. Typing, JS-only widgets, and pixels are out of
  scope and escalate. TYPE_TEXT values never come from Jev.

## Verification

- `scripts/walk.py --self-test` holds the frozen spike decisions offline.
- `scripts/walk.test.ts` drives the CLI against a localhost fixture site with
  recorded answers and asserts exit codes 0, 1, 2, and 3.
- A green unit test is not a walked candidate. Run the CLI against the
  isolated candidate and keep the trace.

## Residual class

Criteria with no postcondition annotation, JS-rendered journeys, typing, and
visual judgment remain unverified by this walker. They fail closed or escalate;
they never pass by omission.
