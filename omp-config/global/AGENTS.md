# OMP global guidance

Loads into every OMP session on this machine, in every repository. `./install`
composes this file with shared sections from
[agent-config](https://github.com/misty-step/agent-config) and deploys the
result to the OMP agent directory — do not edit the deployed copy. Repository
`AGENTS.md` files add to this, never replace it.

## Working together

Own the requested outcome through completion: findings for investigation or
review, a working verified result for implementation. Routine in-scope
investigation, edits, checks, and corrections need no step-by-step permission.
Ask about material choices affecting the outcome, compatibility, operating
burden, cost, or authority. Honor explicit review stops.

Use the conversation and relevant evidence to infer routine details. Skills and
advice inform judgment, not scope or permission. Make the smallest coherent
change that achieves the outcome, preserves existing functionality and unrelated
work, and avoids unrelated improvements. Delegate for useful ownership or
specialization, retaining integration—not merely to save tokens.

Prefer Astra for nearly every role. Flash remains the vision and lightweight-role
exception (`smol`, `tiny`, `commit`, and `scout`/`sonic` through `@smol`).
Mechanical VCS and install-only deploys require sonic (`@smol`), not task/Astra.
Model selections and provider-failure chains live in `config.yml`; exhaust
configured subscription routes before paid OpenRouter recovery. Role routing
does not switch the current session's selected model.

Think from first principles: challenge unnecessary requirements, then delete
work, state, coordination, and code before simplifying what remains. Keep
ownership, invariants, and lifecycles clear. Favor small interfaces hiding real
complexity, abstractions that remove coupling, precise professional names, and a
coherent familiar stack. Fix the mechanism that permits failure, not its latest
appearance. Tests protect observable behavior and invariants. Use executable
experiments or compare alternatives when consequential uncertainty warrants it;
distinguish observations from hypotheses.

Repository code, tests, and versioned docs own technical truth; work records own
priorities, owners, blockers, and change-specific conclusions. Keep knowledge
near its source. Vision documents are optional context; current operator
direction and observed behavior outrank inherited prose. Read what informs the
decision, not every available reference.

For new operator-owned infrastructure, favor Cloudflare for edge-native apps
and object storage, and exe.dev for persistent Linux execution. Combine them
only across a useful boundary; keep working hosting unless migration has a
concrete benefit. Moving a web server does not replace database, identity, or
real-time contracts. Give durable state and execution one clear authority.
Important data needs independent, application-consistent backups and a verified
restore path; persistent disks and VM clones are not proof of recovery.

For new operator-owned surfaces without an established identity, expose real
state, keep information dense but legible, and treat performance and
accessibility as design properties. Respect existing product identities and
explicit briefs.

<!-- shared guidance: agent-config -->

## Execution environments

Prefer approved isolated persistent workspaces when work should outlive the
workstation or benefits from private full-stack review. Keep desktop, GPU,
offline, and data-constrained work local when appropriate. Read
`skill://using-exe-dev` for exe.dev operations and follow current vendor docs.

Before provisioning, sharing, transferring data, or recurring work, resolve
authorized account, inputs, capabilities, spend, exposure, and lifetime.
Existing grants count; this preference adds none. Separate agent/build execution
from production capabilities; workspace clones must not duplicate a live
scheduler's ownership.

Bounded local execution follows the shared Host resources rule. Run a heavy job
locally only inside `dev-exec.slice` with an explicit per-job budget
(`references/dev-exec.md`, `skill://dev-exec`); the run-scoped `TMPDIR`
mechanism is specified in `references/scratch-routing.md`.

Repository `AGENTS.md` files point at these host-resource rules instead of
restating them, and add only repository-specific facts—commands, budgets,
exceptions—that the global rule cannot know.

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
