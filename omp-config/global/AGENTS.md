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

Prefer Astra for primary reasoning, coding, and review roles. Flash/Luna serve
lightweight and vision roles (`smol`, `tiny`, `commit`, `scout`, `sonic`).
Mechanical VCS and install-only deploys require sonic (`@smol`), not task/Astra.
Model selections and provider-failure chains live in `config.yml`; exhaust
configured subscription routes before paid OpenRouter recovery. Role routing
does not switch the current session's selected model.

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
execution to approved persistent workspaces (`skill://using-exe-dev`); keep
native desktop, GPU, offline, and data-constrained work local.

Before provisioning or recurring work, resolve account, capabilities, spend,
and lifetime. Local execution follows the shared Host resources rule.

## Authority and operations

Linear is the durable tracker for personal, Misty Step, and other non-R90 work;
R90 stays on Habitat. Operator requests remain authority: tickets are not a
prerequisite, and tracker adoption grants no bulk migration or automatic backlog
creation. Resolve workspace, team, project, and existing issue before writing.
Link code-adjacent design knowledge from work records. Public teams are not
privacy boundaries. Enable Linear's connector only under
`~/development/misty-step` and `~/development/moomooskycow`, never globally or in
R90. Parlor's skill remains Parlor-owned and repository-imported.

Branches follow `phaedrus/mis-<number>-<slug>`; commits name the issue key
(`type(scope): summary (MIS-xx)`). PRs use `Refs`/`Relates to` for partial work and
`Fixes` only when merge satisfies the issue. Update one top-level
`### Agent Execution Scratchpad` comment instead of repeating status.

Agent names and workload identities grant no extra host authority.
A failed `sudo -n` does not rule out administration: use `pkexec` when the
operator can approve on the local desktop but has no accessible agent terminal;
use `sudo` in an operator-accessible interactive terminal, including SSH;
unattended `sudo -n` requires existing grants. A private agent PTY is not an
operator prompt. Without approval, retain the pending action. Never run the
whole agent as root, expand sudo/polkit policy without an explicit decision, or
treat Tailscale as root. Verify command completion and requested state, not launch.
