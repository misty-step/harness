# Runnable verification authoring

A commissioned repair delivers a capability a fresh agent can discover and use,
not a skill-shaped document or a portfolio rollout. Reconcile existing commands,
fixtures, skills, CI, and operational docs before adding machinery. Product
knowledge stays with the product, normally in
`.agents/skills/<project-specific-name>/SKILL.md` with focused journey references.

`scripts/check` is the executable full-gate entry (ADR-004); a thin wrapper may
preserve the native gate. Keep sufficient existing smoke/specialist interfaces
rather than imposing another name or schema. A library needs an executable
consumer, not a browser stack.

For each significant journey, link its story ID where present, prerequisites,
representative target/data/identity, actual interaction surface, independently
observable postconditions, limitations, and owned teardown. Keep volatile run
state and ephemeral accessibility references out of durable instructions.

Add helpers only for recurring product-specific work: fixture setup, difficult
states, runtime selection, or bounded condition waits with actionable errors.
Deterministic assertions and live interaction defend different claims; a receipt,
screenshot, self-report, and unit pass are not interchangeable proof. Use
`skill://test-audit` for a permanent test's value bar.

Exercise setup, behavior, inspection, and teardown from a fresh authorized state;
prove the intended agent can use the path without unpublished conversation
context. Explicit-resource runners may disable ambient skills: use their normal
composition path. Update the procedure with setup, identity, navigation, or
cleanup changes. Prose-only edits need meaning/reference/discovery checks, not
an invented product walk. Keep source/run/target and skipped or unverified
outcomes explicit. A missing real backend is a missing prerequisite, not a fake
fallback. Runtime detail: [runtime.md](runtime.md).
