---
name: verification-infrastructure
description: Create or repair a commissioned repository's runnable verification capability.
disable-model-invocation: true
argument-hint: "[optional repository, journeys, or constraints]"
---

# Verification infrastructure

Deliver a capability a fresh agent can discover and use to establish whether
meaningful product behavior works. Reconcile what exists; create what is missing.
A skill file or standard directory tree is not the outcome.

Work within the commissioned repository and scope. This authors capability; it
does not authorize a portfolio rollout, scheduler, automatic backlog, or shared
backend operation. Ordinary feature work uses and maintains the resulting skill;
`foundation` only assesses the need for repair.

## Choose the missing capability

Identify the important user journeys or consumer contracts and inspect existing
skills, development commands, fixtures, checks, CI, and operational documentation.
Preserve useful interfaces: complete a working smoke command or specialized skill
rather than wrapping it to impose a common name or schema. Product knowledge is
the custom part; a library need not acquire a browser stack or container setup.
Resolve consequential uncertainty with a small experiment, not a feature catalog.
Derive the journey list from `USER_STORIES.md` when the repository has one;
each significant journey carries its story id, so coverage is provable by scan.
When the journey is a browser, the driver is `skill://jev-qa-walk`; keep the
repository's existing `qa:agent` or `qa:agentic` entry point and call it — do
not wrap it in a new name.

- Read [runtime boundaries](runtime.md) when changing setup, environments,
  identities, external integrations, or retained previews.
- Read [journey capability](journeys.md) when authoring or repairing journey
  instructions, interaction helpers, or correctness checks.

Keep reusable knowledge, fixtures, and helpers with the owning product. Use its
existing skill convention, normally `.agents/skills/<project-specific-name>/SKILL.md`.
Keep a sufficient existing entry point; link authoritative commands and focused
journey references instead of copying procedures or generating a competitor.

## Completion and proof

For a new or materially repaired executable path, exercise its setup, actual
behavior, inspection, and owned teardown from a fresh authorized state. Establish
that the intended agent can discover and use it without unpublished conversation
context. Explicit-resource runners may disable ambient skills; use their approved
composition path without broadening authority.

Use repository-owned checks and inspect their results. Evidence must identify
the source, run, target, and exercised surface: local or emulated behavior does
not prove a hosted deployment or physical device. Keep skipped, stale, unsupported,
and unknown outcomes explicit. Prose-only changes need meaning, reference, and
relevant discovery checks—not an application run or model evaluation by default.

Update affected procedures with their owning behavior and use existing CI for
meaningful deterministic checks. Reference integrity alone is not semantic
freshness; any recurring drift review belongs to a separately authorized execution
system. Sanitize shared evidence and keep per-run artifacts in approved storage,
not Git by default.

Finish reachable scoped work when a prerequisite is unavailable; identify the
precise missing capability or authority and the unverified outcome, without fake
fallbacks or scope expansion. Return canonical entry points, what changed or was
preserved, observed verification and cleanup, and remaining limits. Store reusable
procedures in the repository and change-specific conclusions in its work record.
