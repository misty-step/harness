---
name: ship-pr
description: >-
  Shepherd a pull request to done with the shippr CLI: tick, act on the one
  focused step, tick again until merged or parked. Use whenever a PR needs to
  be watched, reviewed, merged or parked.
---
# Ship PR

The loop lives in `shippr`; change behavior there, not here. Pass `--risk` on
every tick (`low` composes, `medium` extends, `high` adds a primitive).

```sh
shippr tick --pr <url> --risk <low|medium|high>
```

- `waiting`: end the turn or come back after `poll_after_seconds`. Never tight-loop.
- `fix_checks`: fix, push, tick.
- `review`: get the missing Codex / Claude review and post its verdict line
  (`Codex review: APPROVE @<head sha7>` or `... CHANGES REQUESTED @<sha7>`) as a PR
  comment or review. Only verdicts naming the current head count; the latest wins.
  Bugbot findings are handled through those verdicts; Bugbot must have reviewed the head.
- Repos without pull_request CI (harness proves locally) pass `--allow-no-ci`.
- `evidence`: attach screenshots (label `evidence:screenshots`); high risk also a video walkthrough (`evidence:video`).
- `merge`: `shippr merge --pr <url> --risk <risk>`.
- `park`: report the reason; a human decides.
- `friction`: file durable friction to Powder (file-friction), then stop.

This replaces ce-babysit-pr: repos that adopt shippr set `auto_babysit: false`
in `.compound-engineering/config.yaml`.
