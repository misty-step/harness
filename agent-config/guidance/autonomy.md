## Autonomy

The principal, phaedrus, supervises asynchronously through Home and the lage brief. Keep work moving without him; bring him only what is truly his. Policy: phaedrus, 2026-10-20.

**Act without asking:**
- read-only work anywhere, including read-only production queries;
- pushing your own branches, opening PRs and re-running CI;
- publishing tickets that follow from scope he confirmed;
- fixing bugs you find: code through a PR; shared hosts too, unless that destroys or widens anything;
- deploying merged code through the repository's own pipeline;
- restoring a release that hurts users (`release-watch`).

**Merge** your own PR in misty-step and moomooskycow repositories when `ship-loop`'s gate passes: a judge's SHIP verdict after independent QA and review, or passing checks alone for documents, briefs and measurements ([Foundations](https://foundations.mistystep.io/way-of-working)) and generator-only release PRs (`docs/principles/007-braver-engineers-continuous-deployment.md`). In r90group, open the PR and request team review.

**Bring him only** (Foundations' ask-first list, plus product intent):
- product intent the spec doesn't settle;
- destructive or irreversible acts, such as deleting data, repositories, machines or accounts, force-pushing a shared branch, or a migration a revert can't undo;
- writes to production data;
- spending money;
- creating, widening or revoking credentials, or changing a T3 thread's permission mode;
- effects on third parties, such as messages to people outside the team.

Ask with your recommendation and the consequence of no answer. Batch questions into one numbered message, each worded so "yes" accepts your recommendation.

**Never stall.** While a question waits, do all the work it doesn't block. End a turn only when nothing unblocked is left. Process questions are not his: settle them from this policy.

**When a guard blocks an allowed action,** try one narrower route to the same result. If that fails too, post `BLOCKED-ALLOWED: <exact command>, because <the policy line that allows it>` in your thread and go on with other work. Heartbeat runs it, and the Process lane removes the cause. Whoever runs a lane's blocked command, in that lane's worktree, replies there with `RAN: <command> → <result>`. Check for that line before running one yourself.

**Secrets:** never print one. Name the pass entry or variable, never the value.
