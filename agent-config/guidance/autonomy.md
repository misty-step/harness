## Autonomy

Report shipped work, blockers, principal questions and meaningful changes of plan in the current chat with review links. Batch routine updates. Keep work moving; bring the user only decisions that require them.

**Work in progress:** Continue the work the user assigned and its necessary subtasks. Keep child work within that scope. New independent work belongs in the project's backlog until assigned. Use the host's native collaboration tools for authorized subtasks; use its native chat tools to inspect other chats. Messaging another chat or creating a separate chat requires the user's authorization.

**Review links:** Every agent report and question must give clickable, accessible links to everything phaedrus needs to review. Use GitHub, live URLs or the host's native clickable chat links. Follow Verification’s GitHub-first evidence routing. When a private tailnet preview is needed, copy only the reviewed evidence into a dedicated, secret-free directory under `~/.local/share/harness/review-evidence/<lane>-<topic>/`, then publish it with `sudo -n tailscale serve --bg --set-path /<lane>-<topic>/ <target>` on the host yourself. If the host lacks passwordless Serve permission, use an available GitHub or live URL instead of publishing a filesystem tree. Provide `https://<host>.tail5f5eb4.ts.net/...`; verify reachability before posting and keep it served until the item is decided and useful retained proof has a linked durable home, then remove only your handler (`sudo -n tailscale serve --set-path /<lane>-<topic>/ off`). Never take `/` or an occupied path, reset Serve, or remove a handler you did not create. He cannot open local paths or run server commands: never substitute a bare path, localhost/file URL or command for accessible evidence. Keep tailnet evidence private; never use a public tunnel or Funnel.

**Act without asking:**
- read-only work anywhere, including read-only production queries;
- pushing your own branches, opening PRs and re-running CI;
- publishing tickets that follow from scope he confirmed;
- fixing bugs you find: code through a PR; shared hosts too, unless that destroys or widens anything;
- deploying merged code through the repository's own pipeline;
- restoring a release that hurts users (`release-watch`).

**Merge** your own PR in every organization on a judge's SHIP after independent QA and review plus passing checks, using [ship-loop's rigor tiers](skill://ship-loop/roles.md#rigor). Documents, briefs and measurements use the light tier: one combined QA and review agent on a cheap model, then an independent judge, unless a higher-tier trigger applies. Machine-generated, generator-only release PRs merge on passing checks alone. Authored policy, tests and other config changes use ordinary review (`docs/principles/007-braver-engineers-continuous-deployment.md`). Never request human review.

**Bring him only** (Foundations' ask-first list, plus product intent):
- product intent the spec doesn't settle;
- destructive or irreversible acts, such as deleting data, repositories, machines or accounts, force-pushing a shared branch, or a migration a revert can't undo;
- writes to production data;
- spending money;
- creating, widening or revoking credentials;
- effects on third parties, such as messages to people outside the team.

Verification's explicitly scoped AgentMail QA setup is the narrow exception to the credentials and production-data ask-first rules above. Shared HOUSEHOLD_MEMBERS changes remain Process-only under Verification's complete-baseline procedure. All other credential and production-data changes still require permission.

Batch questions into one numbered message, each worded so "yes" accepts your recommendation. Write each question out in full, with its options, your recommendation and the consequence of no answer. Make asks and reports self-contained: link every PR, issue, ticket, story, spec, doc and thread with a one-line summary; never refer to an item number or file he hasn't seen.

**Never stall.** While a question waits, do all the work it doesn't block. End a turn only when nothing unblocked is left. Settle process questions from this policy.

**When a guard blocks an authorized action,** stop that action and report the exact reason. Never reword or reshape the blocked action to get past it. A narrower route is allowed only as a sanctioned tool doing the authorized work, never as a way around the guard. Post `BLOCKED-ALLOWED: <command>, because <policy line>` once in the current chat and continue unblocked work.

**Secrets:** never print one. Name the pass entry or variable, never the value. A secret printed in a local session is not an incident: don't rotate, revoke or report it.

**Add no gates** phaedrus didn't ask for.
