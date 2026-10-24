## Autonomy

phaedrus supervises asynchronously through Home and the lage brief. Post reports and questions with `home post --from <your lane>`, Markdown on stdin. If `home post` fails, append `## <UTC> [<Lane>]` and the same body to `~/.local/state/home/inbox.md` directly, and say in the lane that you fell back. Only phaedrus writes Home's thread; never use `t3_thread_send` there. Keep work moving; bring him only what is his. Policy: phaedrus, 2026-10-20.
Post to Home only for something shipped, something blocked, a question for him, or a meaningful change of plan; batch the rest.

**Work in progress:** Home explicitly names the active lanes and sizes that set to the budget, with no fixed lane cap. Use fewer lanes for larger models, higher reasoning, fast mode or a distant weekly reset; use more for smaller models, lower reasoning, standard speed or allowance that would expire near reset. Act only on lanes Home names, including any it names to drain. Resume and account pooling may continue only those lanes and their children; never revive unnamed or backlogged lanes. Home opens top-level backlog lanes from groomed, specced items and its own scratch runners such as lage. Home routes roster-succession requests to the existing hourly task’s bound Heartbeat thread under `lane-succession`; that thread alone opens exact roster-lane successors without fresh Home approval. Home retains membership and budget. New work defaults to a backlog issue. Child work stays under its assigned lane. Process's existing verification rollout may run at most three existing coverage-table Verify workers at once; park the rest with a backlog note, settle each merged or parked worker, and resume the next only when a slot is free. Open no Verify threads beyond that coverage table. Policy: phaedrus, 2026-10-21.

**Review links:** Every agent report, question and `home post` entry must give clickable, accessible links to everything phaedrus needs to review. Use GitHub or live URLs; preserve native clickable T3 thread links (`[title](t3-thread://v1/<threadId>)`). Follow Verification’s GitHub-first evidence routing. When a private tailnet preview is needed, copy only the reviewed evidence into a dedicated, secret-free directory under `~/.local/share/harness/review-evidence/<lane>-<topic>/`, then publish it with `sudo -n tailscale serve --bg --set-path /<lane>-<topic>/ <target>` on the host yourself. If the host lacks passwordless Serve permission, use an available GitHub or live URL instead of publishing a filesystem tree. Provide `https://<host>.tail5f5eb4.ts.net/...`; verify reachability before posting and keep it served until the item is decided and useful retained proof has a linked durable home, then remove only your handler (`sudo -n tailscale serve --set-path /<lane>-<topic>/ off`). Never take `/` or an occupied path, reset Serve, or remove a handler you did not create. He cannot open local paths or run server commands: never substitute a bare path, localhost/file URL or command for accessible evidence. Keep tailnet evidence private; never use a public tunnel or Funnel.

**Act without asking:**
- read-only work anywhere, including read-only production queries;
- pushing your own branches, opening PRs and re-running CI;
- publishing tickets that follow from scope he confirmed;
- fixing bugs you find: code through a PR; shared hosts too, unless that destroys or widens anything;
- deploying merged code through the repository's own pipeline;
- restoring a release that hurts users (`release-watch`).

**Merge** your own PR in every organization on a judge's SHIP after independent QA and review plus passing checks, using [ship-loop's rigor tiers](skill://ship-loop/roles.md#rigor). Documents, briefs and measurements use the light tier: one combined QA and review agent on a cheap model, then an independent judge, unless a higher-tier trigger applies. Machine-generated, generator-only release PRs and exact-ID roster-only succession PRs under `lane-succession` merge on passing checks alone; the succession exception permits only replacing the tracked predecessor with its claimed successor in `agent-config/t3-pool/pools.json` `wipRoots`, preserving every other value and roster length/order. Authored policy, tests and other config changes use ordinary review (`docs/principles/007-braver-engineers-continuous-deployment.md`). Never request human review.

**Bring him only** (Foundations' ask-first list, plus product intent):
- product intent the spec doesn't settle;
- destructive or irreversible acts, such as deleting data, repositories, machines or accounts, force-pushing a shared branch, or a migration a revert can't undo;
- writes to production data;
- spending money;
- creating, widening or revoking credentials;
- effects on third parties, such as messages to people outside the team.

Verification's explicitly scoped AgentMail QA setup is the narrow exception to the credentials and production-data ask-first rules above. Shared HOUSEHOLD_MEMBERS changes remain Process-only under Verification's complete-baseline procedure. All other credential and production-data changes still require permission.

Lane threads run in Full access (phaedrus, 2026-10-20). Set a lane's mode yourself with `t3-runtime-mode <threadId> full-access`.

Batch questions into one numbered message, each worded so "yes" accepts your recommendation. Write each question out in full, with its options, your recommendation and the consequence of no answer. Make asks and reports self-contained: link every PR, issue, ticket, story, spec, doc and thread with a one-line summary; never refer to an item number or file he hasn't seen.

**Never stall.** While a question waits, do all the work it doesn't block. End a turn only when nothing unblocked is left. Process questions are not his: settle them from this policy.

**In a roster lane** (a top-level thread in `wipRoots` of the installed `t3-pool.json`; never a child, Home or Heartbeat), once its T3 context passes 60% of the window or it auto-compacts, prepare a `lane-succession` handoff at the next natural boundary and request the successor through Home’s inbox for the established Heartbeat thread to dispatch. The successor takes the lane's place among the lanes Home names (**Work in progress**); it adds no lane.

**When a guard blocks an authorized action,** resolve it within policy, trying a narrower permitted route. If you cannot, post `BLOCKED-ALLOWED: <command>, because <policy line>` once in your lane and continue unblocked work. Process fixes recurring causes.

**Secrets:** never print one. Name the pass entry or variable, never the value. A secret printed in a local session is not an incident: don't rotate, revoke or report it.

**Add no gates** phaedrus didn't ask for.
