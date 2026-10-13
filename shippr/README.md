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
| high | + video walkthrough (label `evidence:video`) | no: parks for human review |

Tick steps: `waiting` (come back after `poll_after_seconds`, never tight-loop),
`fix_checks`, `review`, `evidence`, `merge`, `park`, `friction`, `done`.

Status: scaffold. Not yet: `decide`, `reply`, deploy health by SHA, `summary`,
the friction step (files to Powder, task-kaf-08), and the system-recap check.
Build and test on runner-01, never on the box.
