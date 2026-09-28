# OMP global guidance

Loads into every OMP session on this machine, in every repository. `./install`
composes this file with shared sections from
`agent-config` and deploys the
result to the OMP agent directory — do not edit the deployed copy. Repository
`AGENTS.md` files add to this, never replace it.

## Working together

Own the requested outcome through verified completion. Routine in-scope
investigation, edits, checks, and corrections need no step-by-step permission.
Ask on material choices affecting scope, compatibility, operating burden, cost,
or authority. Honor explicit review stops.

Infer routine details from context and evidence. Skills inform judgment, not
scope. Make the smallest coherent change that achieves the outcome, preserves
existing functionality, and avoids unrelated churn.

Model policy (operator, 2026-09-28), approved subscription routes only:
Sonnet 5.5 medium handles ordinary work and orchestration (`default` and
`@task`); `@slow` selects Sonnet high and `@extreme` Opus 5.5 xhigh.
Anything visual goes to Opus: `vision` and the `designer` agent at high,
raising to xhigh or max for design and visual-language work; never delegate
visual work to `task`. Inspect images with `read <image>?q=<question>` (the
`vision` role) or delegate visual work to `designer`: both stay on Opus and
fail closed during an Anthropic outage. Visual, motion, UX and communications
work must start on Opus and stop rather than change models on an outage.
The configured Opus primary also fails closed in main sessions, at every
effort. This does not repair a session that already fell back to another
model. Direct selections use `@plan` and `security-reviewer` at Astra medium,
`reviewer` at Sol xhigh, `@advisor` at Sonnet 5.5 medium, and `@smol`,
`@tiny`, `@commit`, `scout`, and `sonic` at Luna max. Ordinary OMP `task`
tool children use their configured agent model and thinking, not the live
parent's selection; tagged model agents (`^` then `m1`, `m2`, …) and per-item
`effort` remain explicit overrides. `designer` retains an Opus 5.5 high
minimum: non-Opus parents and Opus parents below high select Opus high;
an Opus parent's high/xhigh/max inherits unchanged. `designer` effort below
`hi` is refused. Grok 4.7 is permitted only for read-only advisory/review
recovery (`advisor`, `reviewer`, `security-reviewer`), never builder fallback.
Gemini 3.8 Flash is the last resort where cross-model recovery is allowed;
Opus has no cross-model fallback. All shared subscription accounts are
authorized for any work. Native account policies prefer eligible r90.dev
Anthropic and Codex accounts; blocked accounts and reserve rules still apply.
Authorization and priority do not establish usable capacity. Sonnet 5 and older,
Cerebras, and unapproved paid fallback models are retired. Mechanical VCS
and install-only deploys use `@smol`. Model selections
and provider-failure chains live in `config.yml`; the model-policy check rejects
unapproved selectors before deployment. Role routing does not switch the
current session's selected model, and an already-running process retains its
model catalog after a binary update; restart it to pick up new catalog IDs.
Read the resolved model and thinking badge on each task result; the agent name
alone does not identify what actually ran.

Repository code, tests, and versioned docs own technical truth; work records
track priorities, owners, and blockers. Delete unnecessary code, state, and
coordination before simplifying what remains. Keep invariants clear and
interfaces minimal.

For new operator-owned infrastructure, favor Cloudflare for edge-native apps and
object storage, and exe.dev for persistent Linux execution. Durable state
requires single-authority ownership and a verified backup/restore path.

<!-- shared guidance: agent-config -->

## Execution environments

Follow the shared Host resources exe.dev mandate: offload heavy and long-running
execution to each project's owned workspace with `ws` (`skill://using-exe-dev`);
keep native desktop, GPU, offline, and data-constrained work local. Standing
operator approval (2026-09-25) covers one `<project>-ws` VM per project within
the current $40 exe.dev plan. Other VMs need approval. Agent sessions and
model credentials remain local pending a separate operator decision.

Parallel work: subagents that write overlapping files, or experiments you may
discard, run as `task` items with `isolated: true`; their changes return as a
patch applied to the canonical checkout. Disjoint-file delegates share the
working tree. Isolated agents cannot be revived, so give them complete tasks.
Review a PR from `pr://<N>/diff`; `pr_checkout` only to run its code. Parallel
sessions that need their own services or long runtimes go to exe.dev.

## Authority and operations

Linear is the durable tracker for personal, Misty Step, and other non-R90 work;
R90 stays on Habitat. Operator requests remain authority: tickets are not a
prerequisite, and tracker adoption grants no bulk migration or automatic backlog
creation. Before writing to Linear, resolve workspace, team, project, and
existing issue.
Link code-adjacent design knowledge from work records. Public teams are not
privacy boundaries. Enable Linear's connector only under
`~/development/misty-step` and `~/development/moomooskycow`, never globally or in
R90. Parlor's skill remains Parlor-owned and repository-imported.

Linear access is available; never conclude otherwise without trying. Use the
Linear MCP tools when mounted. Otherwise use the GraphQL API with the workstation
key (team `MIS` = Misty Step), never printing the value:
`pass-env run -e LINEAR_API_KEY=workstation/LINEAR_API_KEY -- sh -c 'curl -s
https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H
"Content-Type: application/json" -d @query.json'`. Verify with
`{ viewer { name } teams { nodes { key } } }`.

When a relevant issue exists, use its key in the branch
(`phaedrus/mis-<number>-<slug>`) and commit (`type(scope): summary (MIS-xx)`).
Without one, use a descriptive branch and conventional commit. Linked PRs use
`Refs`/`Relates to` for partial work and `Fixes` only when merge satisfies the
issue. Update one top-level `### Agent Execution Scratchpad` comment instead
of repeating status.

Agent names and workload identities grant no extra host authority.
A failed `sudo -n` does not rule out administration: use `pkexec` when the
operator can approve on the local desktop but has no accessible agent terminal;
use `sudo` in an operator-accessible interactive terminal, including SSH;
unattended `sudo -n` requires existing grants. A private agent PTY is not an
operator prompt. Without approval, retain the pending action. Never run the
whole agent as root, expand sudo/polkit policy without an explicit decision, or
treat Tailscale as root. Verify command completion and requested state, not launch.
