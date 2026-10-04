# summon groundwork

Reversible source for the approved multi-harness design, not a deployed dispatcher.
No installer, roster or fleet caller selects this candidate. Kaylee stays on
Hermes; OMP stays available. [Round 2 design](../../../docs/design/multi-harness-r2.html)
separates built behavior from the remaining rollout.

## Contract and ownership

`TaskSpec` in `contract.ts` carries an opaque task ID, implementation/research
kind, brief, absolute workspace, harness/provider/model/effort route, supplied
checks and relative output paths. Optional source provenance does not become
its identity. `glass.ts` converts a frozen Glass snapshot; the core never queries
Glass and a task without Glass works the same way.

Glass intake retains the ticket's why, victory and done descriptions in the brief;
the commissioner still supplies the executable/review check policy explicitly.

The common SQLite store owns task, steering and proof metadata. Native harnesses
own their sessions and transcripts. The separate private Pi Durable lab owns
its engine checkpoints; its history and runtime data are not imported here.

A repeated identical task returns its existing run; a conflicting specification
under the same ID is refused. Steering is keyed by request ID and exact text:
repeats return the existing outcome and conflicting text is refused. Delivery
states are `queued`, `dispatching`, `acknowledged`, `answered`, `uncertain` and
`failed`. Queued is not delivered. Only one native turn runs at a time; new
steering queues between turns, not into a live native process.

An ambiguous dispatch is never automatically resent. Reconciliation requires
an explicit native-session receipt, not a guess that the process did nothing.
This is input deduplication, **not exactly-once external effects**. A push,
message or other irreversible effect still needs its own safe authority.

Implementation and research have distinct working states. Native completion
moves the run to `awaiting_review`, not verified delivery. Task policy can use
command checks, review criteria or both; there is no universal shell command,
Git repository or cross-family review requirement in this general-purpose core.
The commissioner supplies the appropriate reviewer policy for each task.

Verified delivery requires at least one supplied check, all checks passing for
the current delivery, and all declared outputs present. Proof freshness covers
the task, inputs, answers, output bytes and available workspace revision. A new
steer or changed delivery invalidates previous checks and review receipts.
Waiting for input, interrupted and stopped remain visible, never successful.
Review receipts name the run, check, delivery digest, reviewer, verdict and
evidence. Same-user local state and commissioner assertions are not a
cryptographic authentication boundary.

## Local command line

`--state-dir` is required and has no live/default location. Use an owner-only
scratch directory. `TASK_FILE` is a complete `TaskSpec` JSON file; `TASK_ID` is
its opaque ID, not a required Glass or repository identifier.

```sh
bun agent-config/candidates/summon/cli.ts --help
bun agent-config/candidates/summon/cli.ts start --state-dir "$STATE_DIR" --task "$TASK_FILE"
bun agent-config/candidates/summon/cli.ts say "$TASK_ID" --state-dir "$STATE_DIR" --request-id clarify-1 --text "Include the additional source."
bun agent-config/candidates/summon/cli.ts run "$TASK_ID" --state-dir "$STATE_DIR"
bun agent-config/candidates/summon/cli.ts status "$TASK_ID" --state-dir "$STATE_DIR"
bun agent-config/candidates/summon/cli.ts inspect "$TASK_ID" --state-dir "$STATE_DIR"
bun agent-config/candidates/summon/cli.ts check "$TASK_ID" --state-dir "$STATE_DIR"
bun agent-config/candidates/summon/cli.ts review --state-dir "$STATE_DIR" --receipt "$REVIEW_FILE"
bun agent-config/candidates/summon/cli.ts stop "$TASK_ID" --state-dir "$STATE_DIR"
```

Review and reconciliation JSON shapes are defined in `contract.ts` and `core.ts`.
Do not manufacture a pass receipt or declare an unacknowledged uncertain turn
unsent. CLI results/errors are JSON; blocked checks and native refusals exit
nonzero. Frozen intake is independent:
`bun agent-config/candidates/summon/glass.ts SNAPSHOT.json INTAKE.json`.

## Native lanes and limits

- Claude Code serves Anthropic subscriptions. Existing native `claude.ai`
  authentication and a subscription type are required; API/cloud routes and
  inherited Anthropic credential overrides are refused. It acknowledges the
  exact submitted message through native replay and resumes the native session.
- Antigravity serves `google-antigravity`. The selected model must appear in the
  signed-in native registry. It has completion-only acknowledgement: a `DONE`
  user-input step is not a message receipt. It resumes the native conversation.
- Native model and usage fields are retained only when reported. Missing values
  remain unknown. Native-reported identity is not independent provider proof;
  matched evals still need actual-request route/effort evidence.

Every native probe and turn uses the existing source `omp-display.py` boundary.
Its kernel namespace/provenance checks, not environment markers, grant reuse of
an existing private namespace. Missing confinement fails closed; no unfenced
fallback. The child environment excludes other-provider keys and desktop
brokers. Owned process groups and identity-checked descendants are stopped on
cancellation. This is not a general filesystem or credential sandbox.

Both installed native CLIs are signed out here. Actual fenced preflight reaches
the installed commands and refuses without a model call. Protocol record-player
tests do **not** prove authenticated native turn, steering, persistence or
kill-and-resume behavior. Those need existing native sign-ins supplied by the
operator; never borrow OMP/Pi rotating tokens or initiate login from an engineer.
Extra usage must remain off. This candidate does not inspect billing, quota,
resource admission or allowed external actions; production needs those guards.

The model/effort selector is passed unchanged. Native aliases are usable
selectors, not reproducible model pins for a matched experiment. No alternate
model/provider fallback is selected by this adapter. General native actions
remain subject to each harness's permission system and task authority.

## Verification and rollout

The canonical shared/all check includes these tests, sequentially:

```sh
./scripts/check shared
```

The revised design documents the exact bounds of the older lab checks.
`check-status.ts` proves one fixture-reader snapshot under a concurrent owner;
`merged-and-installed.sh` is a Hermes-config-specific mutable-log tripwire, not
a general delivery/authenticity rule; `kill9.sh` reaching a done event does not
itself prove acceptance. A no-leaks history scan does not sanitize private run
data.

Reuse `misty-step/evals` and its frozen six-task `eng-vibe@1` pilot, oracles,
sandbox and billing/quota guards. Do not alter the cancelled September plan.
A new committed plan must pin the same provider, model and effort in both arms,
record every attempt and intervention, and size the decision by a preregistered
margin rather than an arbitrary ticket count. No matched results exist yet.
The private lab's GitHub publication, engine integration, eval runner, fleet
readers and provider canaries remain separate production steps. No OMP
retirement follows from this source-only groundwork.
