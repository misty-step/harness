# ADR-023: Resolve OpenRouter account by launch directory

Accepted 2026-09-25 (US-028).

Kaylee approved R90 billing for R90 work in OMP and Pi. The Pi installer owns
only `.openrouter` in the live `auth.json`, preserving other providers. It
installs `openrouter-key` from `agent-config`, shared with OMP: R90 directories
and linked worktrees with Git common directories under `~/development/r90group`
choose `workstation/OPENROUTER_R90_HARNESS_API_KEY`, while other directories use
Pi's existing `workstation/OPENROUTER_API_KEY_MIRRODIN_PI`.

Pi caches command credentials per process. On a missing or malformed pass entry,
the launcher returns a fixed invalid token rather than failing the command:
otherwise an ambient `OPENROUTER_API_KEY` could silently bill personal. No
credential value is versioned. Start a new session when changing account class;
revisit this decision if Pi gains native per-project auth or changes command
credential precedence.
