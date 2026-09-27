# REPORT — continuation nudges (harness target)

Card: `t_e3413f63` (child task, harness target) · Branch: `zoe/continuation-nudge` ·
PR: https://github.com/misty-step/harness/pull/15 · Base: `origin/main` @ `c67c5b9`.

Commits:

- `ef17beb` feat(continuation-nudge): bounded Jev continuation nudge for pi and OMP (US-010)
- `d43c8e0` chore(continuation-nudge): ignore synthetic redaction fixtures in secret scan
- Pushed head: `d43c8e0bdf49cf7a40726a10f834b52d6c5b2bdf`

Operator overrides applied from the task prompt:

- OpenRouter `typesafe/jev-1.13` only; **no** TypeSafe-direct fallback
  (`TYPESAFE_API_KEY` is ignored; a test proves it).
- **No live deployment** to `~/.pi` or `~/.omp`. Native loading was exercised in
  isolated temporary agent homes only.
- Ledger rows say `no (deferred)` — no installed-by-installer claim.
- Original and carried-forward requests preserved: the state carries
  `original: …\nlatest: …` when the first and last user messages differ.
- `scripts/verify` was **not** edited (PR #8 owns that file; see Deferred).

## Files created / changed

New:

- `agent-config/system-one/continuation.ts` — shared module: frozen prompt,
  `CONTINUATION_QUESTIONS`, `NUDGE_MESSAGE`, `decideNudge`, `renderNudgeMessage`,
  `redactText`.
- `agent-config/system-one/continuation.test.ts`
- `pi-config/extensions/continuation-nudge/` — `index.ts`, `decide.ts`,
  `decide.test.ts`, `index.test.ts`, plus the `continuation.ts` and `engine.ts`
  repo shims that the future installer materializes over (same pattern as
  `diff-review`).
- `omp-config/extensions/continuation-nudge/` (same shape; OMP-specific parser
  and settle handling documented in the README)

Changed:

- `USER_STORIES.md` — US-010 (US-010 was free; PRs #8/#9 use US-007..US-009).
- `pi-config/README.md` — divergence-ledger row, `no (deferred)`; detailed
  section.
- `omp-config/README.md` — new divergence-ledger table row; “Continuation
  nudge” section documenting the OMP API gap.
- `.gitleaksignore` — five exact fingerprints for synthetic redaction fixtures
  (fake private-key block and fake Bearer tokens used to assert masking).

Not touched (concurrent owners): `agent-config/system-one/engine.ts`,
`evidence.ts` and its fixtures/tests, `{pi,omp}-config/extensions/evidence/*`,
`pi-config/install`, `omp-config/install`, `scripts/verify`.

## Test evidence (real outputs)

1. Scoped suite:

```
bun test --max-concurrency=1 agent-config/system-one/ \
  pi-config/extensions/continuation-nudge/ \
  omp-config/extensions/continuation-nudge/
→ 83 pass / 0 fail, 287 expect() calls, 5 files, ~22 ms, no network.
```

Coverage per the brief: registration; nudge emission with the fixed message +
marker; suppression matrix (choice `no_nudge`, aborted, error, pending, off,
no-key); second-nudge-needs-progress with provider-not-called proof; the
non-code premature-stop case (memo in chat, zero edits) with stub and the
inverse; bound at MAX; fail-open on provider throw; redaction and
`< 2500`-char state; session_start reset; `/continuation` output without the
key value; OMP `willContinue` and idle-during-`agent_end` paths; the
state-cap fail-closed path.

2. Canonical verification (all passed):

```
./scripts/verify pi      → PASS (unit suites + fresh-clone installer checks)
./scripts/verify omp     → PASS
./scripts/verify shared  → PASS
```

Caveat: `scripts/verify`'s shared glob does not include `system-one/` yet (the
one-line change belongs to PR #8's file); the shared suite passes under the
explicit command above.

3. Exact-head CI: `gh pr checks 15` on `d43c8e0` → `verify` **pass** (11 s);
CodeRabbit pass (rate limited). The workflow's semantic-gate step did not run a
live review in this CI run.

## Live smoke (real API, bounded, distinct from stubs)

Key came from the local pi auth store in-process; never printed.

| State | Answer | Confidence | ms |
| --- | --- | --- | --- |
| mostly-finished, decides next step | `no_nudge` (0.56) | 0.13 | 355 |
| “I will draft the memo now”, zero tools | `no_nudge` (0.65) | 0.30 | 293 |
| unfinished work with prior nudge + progress | `nudge` (0.86) | 0.71 | 276 |

The third clears the default 0.5 minimum and exercises the nudge path live. The
second is worth an operator look: Jev does not nudge a plain
statement-of-intent stop even though the prompt says unfinished work counts.
Question wording is frozen, so tuning is an operator decision (open question).

## Native loading evidence (isolated homes, no live deploy)

Pi, `PI_CODING_AGENT_DIR=~/.cache/tmp/pi-continuation-isolated/.pi/agent`:

- status file after first session:
  `{"version":"continuation-v1","loaded_at":"...","mode":"on","key_resolved":false}`
- RPC-mode settle cycle: assistant turn 1 → injected `custom_message`
  (`continuation-nudge`, exact advisory text) → marker custom entry → assistant
  turn 2 → second settle logged `skip/no-progress-since-nudge`. Log:
  `nudge/nudge/attempt 1/latency 0/model stub-nudge/stub true`.
- real key path: `key_resolved:true` at session start and
  `no_nudge/choice-no_nudge/227 ms/model modelRegistry` on settle.

OMP, fresh isolated HOME (`~/.cache/tmp/omp-continuation-isolated`):

- status file written (`mode on`), so the extension loads natively.
- stub print-mode run: `custom_message` persisted, marker persisted, log
  `nudge` then `skip/stop-reason-aborted` (print mode disposes the triggered
  follow-up).
- real key path at session start: `key_resolved:true`.

Reload needed: no — both are fresh sessions; the deployed extension loads at
session start. Nothing was deployed to a live agent dir.

## OMP API gaps (honest, documented in omp-config/README.md)

- OMP 18.2.6 has no `agent_settled`. Settle = `agent_end` with
  `willContinue !== true` (the condition OMP's own integrations use).
- `isIdle()` is false during `agent_end` by construction, and deferring a
  macrotask is unreliable in print mode (process disposes at the event). The
  adapter marks the settled event and skips the idle check; `hasPendingMessages()`
  still guards queued work. This is a deliberate, documented divergence from the
  pi guard path.
- OMP lacks `getProviderAuth`; the key resolves through
  `modelRegistry.getApiKey("openrouter")`, then agent-dir `auth.json`, then
  `OPENROUTER_API_KEY`.
- OMP print mode (`omp -p`) disposes at `agent_end`, so async settle work can
  be cut short. Interactive-session verification is still outstanding; unit +
  stub E2E cover the handler.

## Semantic diff review (disclosed, not bypassed)

`bun omp-config/bin/omp-diff-review.ts --range origin/main..HEAD --strict`:

- **HARD BLOCK:** `[POKAYOKE] fails_open` p 0.93 / conf 0.86, localized to
  `extensions/continuation-nudge/index.ts`.
- Warnings: `incomplete_cutover`, `plausible_bug_defense`, `preserves_root_cause`,
  `tests_missing`, plus an advisory `fails_open` 0.84.

Response: one genuine fail-open boundary found by the review was fixed — the
serialized-state character cap now fails closed (`serializeState` returns
`null`; the caller skips with `state-oversize`) instead of returning oversized
state. The remaining block targets the operator-mandated advisory fail-open on
provider errors (US-010.4), which cannot be made fail-closed without violating
the brief. The warning set is miscalibrated (83 tests, incl. a real settle-cycle
E2E). PR #15 carries this disclosure and asks the operator whether the pokayoke
battery should exempt declared advisory-only extensions or the PR should carry a
waiver.

## Deferred (follow-up spec for the PR #8 owner)

- `pi-config/install`: add `continuation-nudge` to `components_all`;
  `validate_continuation_nudge()` requires non-empty `index.ts`, `decide.ts`,
  `decide.test.ts`, `index.test.ts`; `install_continuation_nudge()`
  clean-replaces `$agent_dir/extensions/continuation-nudge/`, copies those four
  files with mode 600, and materializes `$base_dir/system-one/continuation.ts`
  **and** `$base_dir/system-one/engine.ts` over the repo shims (diff-review
  engine pattern).
- `omp-config/install`: the generic extension copy already covers the
  directory; extend the canonical System One materialization block to also copy
  `$base_dir/system-one/continuation.ts` over
  `extensions/continuation-nudge/continuation.ts`.
- `scripts/verify`: add `system-one/` to the shared glob once PR #8 lands
  (`(cd agent-config && bun test --max-concurrency=1 bin/ skills/ system-one/)`).

## Unverified / blockers

- Live pi/OMP agent homes not deployed (by instruction) and installer wiring
  deferred; `./install` does not deploy this package yet.
- OMP interactive-session nudge not exercised (no TTY harness here); OMP
  print-mode dispose timing documented.
- Semantic review block/warnings above need operator adjudication.
- No merge performed; CI on `d43c8e0` passed.