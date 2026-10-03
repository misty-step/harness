# Simplicity audit

Question: what can this repository delete or simplify while keeping every
promise to its users?

This audit replaces the nightly deletion pass. Challenge whole subsystems, not
lint. Look for:

- obsolete paths and duplicated owners of one fact;
- thin wrappers and needless abstractions;
- redundant checks, workflows, dependencies and instructions;
- exposed surfaces.

Keep actual user promises, plus independent access, accepted-state and recovery
safeguards. This audit finds cuts; it does not add process.

Use the vendored references named in the brief:

- `codebase-design`: its vocabulary (module, interface, depth, seam) and the
  deletion test. Would deleting this concentrate complexity, or only move it?
- `improve-codebase-architecture`: its explore questions, aimed at the bundle's
  most-changed files from the last 90 days.
- `retro`: its navigation, information-access, no-op and tool-economy
  questions, asked of the repository's recent agent sessions listed in the
  bundle. A proposed check or pointer must name the session mistake it would
  have prevented.

The bundle's CI section gives each workflow's runs, minutes and failures. A
check that never fails for a real reason, or that duplicates another, is a
candidate. When the bundle carries a Glass complexity receipt, its null values
are unknown, and newer commits are not measured by it.

Each ticket names:

- the exact cut, with the audited commit and paths;
- the estimated net lines removed, and how you counted;
- the failure or exposed surface it reduces;
- the safeguards that remain, and what proves them.
