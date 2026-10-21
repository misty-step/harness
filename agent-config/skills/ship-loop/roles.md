# Role briefs

Every role after the builder gets its brief from the round helper, never from a hand-filled template:

```sh
bun ~/.claude/skills/ship-loop/scripts/ship-loop.ts prompt --pr <PR URL> --role <role>
```

The helper fills the PR, head SHA, ticket, rigor, findings and eligibility from the PR's recorded state, and refuses a role that is out of phase. Each role returns its native thread ID and report link; the conductor writes those with `record`. Roles: `qa-review` (light) or `qa` and `review` (standard, critical), `judge`, `fix-builder`, `recheck`, `final-judge`. Use the same brief for a retry or a new thread; the round does not restart.

## Rigor

Classify the changed path, not the repository or initiative. Prefer light rigor for small, reversible, focused PRs; record `Rigor: <light|standard|critical> — <concrete reason>` and the diff size in the PR body. The judge may raise the tier only with a concrete risk. Size is a prompt to check the choice, not permission to ignore a real risk. Global **Merge** and `lane-succession` define the checks-only exceptions for generator-only releases and exact-ID roster-only successions.

| Tier | Changed path | Review shape and model class |
| --- | --- | --- |
| light | Documents, briefs, config JSON, constants, bounded cosmetic changes and verification tooling without a production runtime path | One combined independent QA/review agent, then an independent judge; Haiku 5.5 or Sol medium. Most small focused PRs should land here in one round. |
| standard | Runtime behavior or operational rules with consequences beyond a bounded light change | Separate independent QA and review, then an independent judge; Opus 5.5 high or Sol high. |
| critical | Concrete changes to authentication, authorization, money, persisted-data integrity, migrations, security controls, deploy behavior, shared-infrastructure runtime or irreversible operations | Separate independent QA and review, then an independent judge; Opus 5.5 high or Sol high. State the actual risk, even for a one-line diff. |

Take an available account in the model class; never wait for one route or start reroute-only threads when another has headroom. Never use claude-hello (reserved for Home), Fable or Astra. Standard speed is the default. Fast mode or xhigh requires a named bottleneck and a reason; critical alone does not require xhigh. All subagents consume the lane's model/effort/speed/reset-sized budget.

Use one QA owner per SHA. Extra cross-family QA is only for a stated critical uncertainty, not an automatic duplicate. Light combines QA and review but keeps the judge independent. Only a judge's FIX naming exact eligible blockers authorizes the one fix round, and the helper records that authorization before the builder runs. Only the blocking reporter rechecks those fixes; retain unchanged evidence. New findings become tickets unless the fix introduced them. The final judge rules SHIP with tickets or REVERT / SPLIT; the helper refuses another FIX. Already on main is never a blocker. Ship heuristic features labeled approximate; accuracy is follow-up.

When context gets heavy, prepare a handoff and request a replacement through Home’s inbox for the established Heartbeat executor within Home’s named set.

## Builder

The builder is the only brief written by hand. Its fix round is `prompt --role fix-builder`, never a hand-written fix brief.

```
You are the builder for <repo> ticket <ticket URL>: <title>.

Goal: make this ticket's acceptance criteria true, and nothing beyond them.
Read first: the ticket, its parent spec <spec URL>, and the repo's AGENTS.md.
Work on branch <branch>, starting from <origin/<default branch> at <SHA> | a stacked
ticket: its blocker PR's head>.
Keep: <the load-bearing lines and rules the change must leave in place | "nothing listed">.
Length is a preference, never a reason to remove a Keep item.

Inspect your diff. Run <check command> and drive the changed path with the repository's
verification skill <path>. If it has none, add one with create-verification-skill
(`.agents/skills/verify-<app>/`, `.claude/skills/` symlink), or say which open PR adds it.
Apply global guidance's mandatory generator override and QA-account contract; run harness's
`scripts/probe-agent-policy --verification <repo>` after generating. Instruction content is
always AGENTS.md alone. Create no CLAUDE.md files or symlinks, including fixtures/private proofs. Put evidence in the PR. Push and open it against <base branch>,
with a Conventional Commit title, the pr skill's body and "Closes #<n>".
Every authored PR body records its `Rigor:` reason and diff size, and carries `Story: <ID>[, <ID>]` using story IDs from SPEC.md or USER_STORIES.md
(for example, `Story: US-012` or `Story: US-012, US-015`). Use `Story: none` when no story applies.
Machine-generated, generator-only release PRs are exempt.

Push your branch and open the PR without asking. Never force-push a shared branch or merge.
Return the PR URL, head SHA, check result, evidence links, your native thread ID and any blocker.
Then the conductor runs `init` on that PR with the same head SHA and your thread ID.
```

## After the builder

- QA, review or combined QA/review: `prompt --role qa-review|qa|review`. Its payload is recorded with `record --kind report`.
- Judge: `prompt --role judge`. Its ruling is recorded with `record --kind verdict`.
- Fix: `prompt --role fix-builder`, then `record --kind head` with `reason: fix`.
- Recheck: `prompt --role recheck`, recorded with `record --kind recheck`.
- Final judge: `prompt --role final-judge`, recorded with `record --kind verdict`.

Each payload carries the native thread ID and report link the role actually returned. Never invent either.
