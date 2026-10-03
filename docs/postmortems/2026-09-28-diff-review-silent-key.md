# Postmortem: a job that could not do its job reported nothing

- **Incident date:** 2026-09-28 19:17 UTC to 2026-10-01 22:17 UTC
- **Status:** Class closed by the outcome route (ADR-009); instance retired in #199
- **Operational owner:** Harness / Misty Step
- **Tracker:** Glass K-20261002-nothing-fails-silently-every-failure-scr

## Summary

OMP's automatic turn-end diff reviewer could not read its model key for three
days and reviewed nothing in 5,656 consecutive runs. Each run wrote the reason
to its own log, showed a dim `diff: no-key` status, and let the write through.
Nothing reached Sentry, the alert intake or the board. The Glass design twin
found it while building the Factory floor page. The class: a job that cannot
do its job degrades to "advisory" or "skipped", exits successfully, and records
its failure only where nobody looks.

## Impact

Observed: `~/.omp/agent/diff-review.jsonl` holds 5,656 disabled reviews with
`ENTRY: OPENROUTER_API_KEY: entry must be an existing regular file with no
symlink components`, from 2026-09-28T19:17:14Z to 2026-10-01T22:17:29Z, then
24 more with `REFERENCE_FILE` errors from engineers still running the old
extension. Every engineer write in that window landed without the review the
harness claimed to run. The retro on 2026-10-01 found it; no alert ever did.
Not established: whether any unreviewed write carried a defect the review
would have blocked.

## Timeline

| Time (UTC) | Observation |
| --- | --- |
| 2026-09-25 16:07 | First logged review; key read at runtime through `pass-env` from `jev.env.pass`. |
| 2026-09-27 15:00 | The renamed utility key entry is created during the OpenRouter key reorganisation. |
| 2026-09-28 19:17 | First `ENTRY` failure: the entry `jev.env.pass` named no longer exists. Reviews stop. |
| 2026-09-28 to 10-01 | 5,656 disabled reviews; each logs its reason; writes proceed. |
| 2026-10-01 | Retro counts 467 runs, 463 disabled; #199 retires the automatic extension. |
| 2026-10-02 | Glass design twin surfaces the log; Phaedrus commissions K-20261002. |

## Evidence and mechanism

- The extension caught every failure and returned `null` or a disabled verdict;
  only the status line and the local log changed.
- The pre-push hook ran its reviewer as `... || printf 'advisory context only'`
  and the semantic check the same way; the pre-commit check never had a key at
  all, so it was always `unavailable` and always swallowed.
- The System One engine turned a provider error into a warning on a *passing*
  verdict, and the CLI exited 0 without a key, so no caller could tell "reviewed"
  from "could not review".
- CI skipped the review whenever its secret was absent, not only for forks.
- [INFERENCE] The key reorganisation retired `OPENROUTER_MIRRODIN_UTILITY_API_KEY`
  without updating the name in `jev.env.pass`; nothing ties a consumer's entry
  name to the entries that exist.

The system permitted it because "advisory" meant "unaccountable": a verdict
could be ignored, and so could the absence of one. No job had an outcome record
anyone else read, and no expected run was declared anywhere.

## Pokayoke

How can we pokayoke this so this kind of error never happens again?

- **Shape.** The engine owns one judgment, `reviewFailure(verdict)`: a missing
  key or provider error is a failed run, never a pass. The CLI exits 2 for it;
  `semantic-check` exits 3 for `unavailable`.
- **One outcome per run.** Every hook check and the Pi automatic review record
  their run through `outcome record`: ok, or failed with a cause such as
  `key-unreadable`, `no-key` or `exit-3`. A missing recorder prints loudly.
- **One path to an incident.** Kaylee's alert intake keeps the run ledger; the
  first failed run of a cause opens one episode and one alert, later runs only
  count, and an ok run closes it. The same 5,656 runs now make one incident
  within five minutes, routed to the owner with a postmortem required to close.
- **CI.** The review step skips only fork pull requests; a missing key fails it.

What remains possible: a job that is not wired to any covered scheduler and
never calls `outcome record` is still invisible. The foundations audit treats
such a job as a gap (constitution foundation 2).

## Post-cutover release credential gap, 2 October

PR #213 made a missing CI review key fail closed, exposing a second credential
boundary: `Verify and Release` called reusable CI without forwarding its
`OPENROUTER_API_KEY`. Direct pull-request CI had the repository secret; the
release caller did not pass it to the called workflow.

The [first failed master run](https://github.com/misty-step/harness/actions/runs/37065518871)
and [fifth failed run](https://github.com/misty-step/harness/actions/runs/37080007565)
both completed all canonical checks, then logged an empty `OPENROUTER_API_KEY`
and exited 2 in semantic review. Last green master was `b4b49f0`; five pushes
failed after `78ee784`. Four alerts remained pending when the route guard checked.

The correction declares the reusable workflow's review secret required and
explicitly forwards only that secret from the release caller. It preserves
fail-closed review, fork isolation and existing release gates, rather than
restoring the old missing-key skip or inheriting every release credential.
Recovery requires a reviewed normal PR and a successful master Verify and
Release run; a direct pull-request check alone does not exercise this boundary.

## Follow-up

- The outcome route and this repository's wiring: ADR-009, this change.
- Name-to-entry drift for `.env.pass` files is not checked ahead of use; with
  the outcome route it now screams on the first failed run instead.
