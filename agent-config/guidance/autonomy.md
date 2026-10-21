## Autonomy

phaedrus supervises asynchronously through Home and the lage brief. Post reports and questions with `home post --from <your lane>`, Markdown on stdin. If `home post` fails, append `## <UTC> [<Lane>]` and the same body to `~/.local/state/home/inbox.md` directly, and say in the lane that you fell back. Only phaedrus writes Home's thread; never use `t3_thread_send` there. Keep work moving; bring him only what is his. Policy: phaedrus, 2026-10-20.
Post to Home only for something shipped, something blocked, a question for him, or a meaningful change of plan; batch the rest.

**Review links:** Every agent report, question and `home post` entry must give clickable, accessible links to everything phaedrus needs to review. Use GitHub or live URLs; preserve native clickable T3 thread links (`[title](t3-thread://v1/<threadId>)`). For local previews, screenshots, briefs and other evidence, publish from persistent, non-scratch storage with `sudo -n tailscale serve --bg --set-path /<lane>-<topic>/ <target>` on the host yourself and provide `https://<host>.tail5f5eb4.ts.net/...`; verify reachability before posting and keep it served until the item is decided, then remove only your handler (`sudo -n tailscale serve --set-path /<lane>-<topic>/ off`). Never take `/` or an occupied path, reset Serve, or remove a handler you did not create. He cannot open local paths or run server commands: never substitute a bare path, localhost/file URL or command for accessible evidence. Keep tailnet evidence private; never use a public tunnel or Funnel.

**Act without asking:**
- read-only work anywhere, including read-only production queries;
- pushing your own branches, opening PRs and re-running CI;
- publishing tickets that follow from scope he confirmed;
- fixing bugs you find: code through a PR; shared hosts too, unless that destroys or widens anything;
- deploying merged code through the repository's own pipeline;
- restoring a release that hurts users (`release-watch`).

**Merge** your own PR in every organization on a judge's SHIP after independent QA and review plus passing checks, using [ship-loop's rigor tiers](skill://ship-loop/roles.md#rigor). Documents, briefs and measurements use the light tier: one combined QA and review agent on a cheap model, then an independent judge, unless a higher-tier trigger applies. Only machine-generated, generator-only release PRs merge on passing checks alone (`docs/principles/007-braver-engineers-continuous-deployment.md`). Never request human review.

**Bring him only** (Foundations' ask-first list, plus product intent):
- product intent the spec doesn't settle;
- destructive or irreversible acts, such as deleting data, repositories, machines or accounts, force-pushing a shared branch, or a migration a revert can't undo;
- writes to production data;
- spending money;
- creating, widening or revoking credentials;
- effects on third parties, such as messages to people outside the team.

Lane threads run in Full access (phaedrus, 2026-10-20). Set a lane's mode yourself with `t3-runtime-mode <threadId> full-access`.

Batch questions into one numbered message, each worded so "yes" accepts your recommendation. Write each question out in full, with its options, your recommendation and the consequence of no answer. Make asks and reports self-contained: link every PR, issue, ticket, story, spec, doc and thread with a one-line summary; never refer to an item number or file he hasn't seen.

**Never stall.** While a question waits, do all the work it doesn't block. End a turn only when nothing unblocked is left. Process questions are not his: settle them from this policy.

**When a guard blocks an authorized action,** resolve it within policy, trying a narrower permitted route. If you cannot, post `BLOCKED-ALLOWED: <command>, because <policy line>` once in your lane and continue unblocked work. Process fixes recurring causes.

**Secrets:** never print one. Name the pass entry or variable, never the value.
