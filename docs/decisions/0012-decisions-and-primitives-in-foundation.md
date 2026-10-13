# 0012: Decisions and primitives in the Foundation Standard, not an ADR diary

- **Status:** accepted
- **Date:** 2026-10-13
- **Primitives:** foundation, skills
- **Powder:** task-kaf-02, task-kaf-10

## Context
`docs/adr/` grew into design briefs: [historical 003](historical/003-foundation-checks.md)
alone runs to hundreds of lines, and nothing told an agent which past "no" still
binds. Repositories had no written map of their primitives, so agents invented
overlapping ones mid-task. Kent C. Dodds's autopilot flow, approved by Phaedrus,
keeps a short steering veto list, a primitives map, and vendored `.agents/skills`.
FND-DOC-001 and [the checker](../../agent-config/bin/foundation-check.ts) only knew
`docs/adr/`.

## Decision
We will not keep an ADR diary. Foundation Standard 1.9.0 requires
`docs/decisions/` (template, index, unique numbers, Status and Context / Decision /
Consequences per live record) and `docs/architecture/primitives.yaml`, and pins a
vendored `.agents/skills/` with `skills-lock.json`. `docs/adr/` is a legacy gap.
The primitives map carries the PR risk vocabulary: `composes` (low), `extends`
(medium), `adds` (high; edit the map in the same PR). Crew-level calls (Maren,
2026-10-13) live in Powder init-kent-autopilot-flow, not here.

## Consequences
Existing pins keep passing; a re-pin to 1.9.0 records `doc:decisions`,
`doc:primitives`, `doc:skills-lock` and `doc:adr` as dated baseline gaps that may
only shrink. Old ADRs move unchanged to `historical/`; principles move to
`docs/principles/`. A record is written after deciding *not* to build something,
never per PR. Revisit if records again grow past half a page, or the map cannot
classify most PRs by longest-prefix match.
