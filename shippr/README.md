# shippr

Risk-gated PR ship loop. A Rust port of the *shape* of Kent C. Dodds's
`@kentcdodds/ship-pr` engine (the Kody package itself is not public), with our
reduce-review-verify-ship policy as the gates. Plan:
`/workspace/shared-infra/skills-and-primitives-review.md` §6 item 6; Powder
`task-kaf-06` under `init-kent-autopilot-flow`.

```sh
shippr policy --risk medium          # gates for a tier (JSON)
shippr tick --pr URL --risk medium   # the one focused next step (JSON)
shippr merge --pr URL --risk medium  # squash-merge, only if tick says merge
```

Risk tiers (from `primitives.yaml`: composes / extends / adds):

| Risk | Gates before the agent acts | Agent may merge |
| --- | --- | --- |
| low | green CI, Codex + Claude `APPROVE @<head sha>` verdicts | yes |
| medium | + Bugbot review of the head commit, screenshots (label `evidence:screenshots`) | yes |
| high | + video walkthrough (label `evidence:video`) | no: parks for Maren via the Glass review queue |

Only verdicts and `bugbot run` triggers from OWNER/MEMBER/COLLABORATOR count. Bugbot does not
re-review every push (seen on omp-config#30), so a missing head review yields `trigger_bugbot`.

Tick steps: `waiting`, `trigger_bugbot` (come back after `poll_after_seconds`, never tight-loop),
`fix_checks`, `review`, `evidence`, `merge`, `park`, `friction`, `done`.

Maintain a marked `## System recap` block in a PR body:

```sh
shippr recap render --primitives routing,policy --risk medium --flow flow.mmd --summary "Extend the ship loop" > recap.md
shippr recap upsert --body-file body.md --block-file recap.md -o updated-body.md
shippr recap apply --pr 123 --repo misty-step/harness --primitives routing,policy --risk medium --flow flow.mmd
```

`render` prints Markdown with primitives, the same `low|medium|high` policy tier,
an optional summary, and a Mermaid fence. Validation runs offline without Node:
the flow must be nonempty, begin with `flowchart` or `graph` followed by
`TD|LR|TB|RL|BT`, `sequenceDiagram`, or `stateDiagram-v2`, and have balanced
brackets and quotes. Fences and recap marker comments in the flow are rejected.
`upsert` replaces the inclusive `<!-- shippr:recap:start -->` /
`<!-- shippr:recap:end -->` block, preserving every byte outside it, or appends
the block after a blank line when absent. Duplicate or unbalanced markers are
errors. Without `-o`, it prints the updated body. `apply` uses `gh pr view` and
`gh pr edit`; `--repo` is optional and all render arguments also apply.

Status: scaffold. Not yet: `decide`, `reply`, deploy health by SHA, `summary`,
the friction step (files to Powder, task-kaf-08), and the system-recap gate in tick.
Build and test on runner-01, never on the box.
