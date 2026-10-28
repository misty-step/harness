# Role briefs

`skill://misty` owns the briefing contract. The builder receives the completed
brief below. Every later role receives only the helper's phase-checked brief:

```sh
bun <skill-dir>/scripts/ship-loop.ts prompt --pr <PR URL> --role <role>
```

`<skill-dir>` is the resolved directory of `skill://ship-loop`. The helper fills
revision, ticket, rigor, findings and eligibility from the PR ledger. Record the
native thread ID and report link actually returned; a retry keeps the same round.

## Rigor

Classify the changed path, not the initiative. Record tier, concrete reason and
diff size in the PR. Size prompts a light-tier check; a concrete risk can raise
it. Generator-only machine release PRs keep the checks-only exception.

| Tier | Changed path | OMP agent and review shape |
| --- | --- | --- |
| light | Documents, briefs, config JSON, constants, bounded cosmetics and verification tooling without a production runtime path | `rigor-light`: builder, one independent combined QA/review, then independent judge |
| standard | Runtime behavior or operational rules beyond a bounded light change | `rigor-standard`: builder, separate independent QA and review, then independent judge |
| critical | Authentication, authorization, money, persisted-data integrity, migrations, security controls, deploy behavior, shared-infrastructure runtime or irreversible operations | `rigor-critical`: builder, separate independent QA and review, then independent judge; name the changed-path risk |

Dispatch with OMP `task`, selecting `rigor-<tier>` in each task's `agent` field.
`skill://setup-mistystack` assigns the three model roles through OMP configuration;
the plugin ships the three matching task agents. The brief determines the work:
builder, QA/review, judge, fix-builder, recheck or final-judge. A recheck uses the
original reporter's scope in a fresh thread. Judge independence is from both
implementation and QA/review, even when all use the same tier agent.

## Builder

```text
Outcome and why: <consumer change, ticket URL, parent spec URL>.
Terms: <DOMAIN.md terms involved>.
Raw material: <failing run, logs, data or source links; not a summary>.
Oracle: <check outside the worker, exact command and expected result>.
Scope: <owned paths, acceptance criteria, branch and base SHA, PR target>.
Keep: <load-bearing behavior or lines to preserve; 'none' when empty>.
Effort: <bounded depth and the uncertainty that deserves it>.

Read skill://misty for the briefing contract, the ticket/spec and repo AGENTS.md.
A missing Oracle returns to shaping. Make the acceptance criteria true within
Scope; length never overrides Keep. Use one isolated worktree.

Run the Oracle and affected checks, then use skill://verification for the changed
consumer path. Its generator owns a missing .agents/skills/verify-<app>/ skill,
or stack on the PR adding it. Link proof from the PR.

Push and open against <base branch>; use a Conventional Commit title and
skill://writing for the body. Include Closes #<ticket>, Story: <IDs|none>,
Rigor: <tier> — <reason>, diff size, and observed verification results.
The conductor owns merge; preserve other writers' commits.

Return PR URL, head SHA, check results, proof links, native thread ID and blockers.
Label each claim measured, inferred or guess in the same sentence.
```

## After the builder

| Work | Helper role | Recorded event |
| --- | --- | --- |
| QA/review | `qa-review` or `qa` and `review` | `report` |
| Initial judgment | `judge` | `verdict` |
| Authorized fix | `fix-builder` | `head` with reason `fix` |
| Named-blocker verification | `recheck` | `recheck` |
| Final judgment | `final-judge` | `verdict` |

Use `record --kind <event> --file <payload.json>`. The helper owns eligibility,
one-fix-round enforcement and retained evidence; do not duplicate its state.
