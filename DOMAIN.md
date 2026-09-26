# Harness domain

Vocabulary, boundaries and invariants for this repository (ADR-004). Intent
lives in [USER_STORIES.md](USER_STORIES.md), decisions in [docs/adr/](docs/adr/),
and agent rules in [AGENTS.md](AGENTS.md).

## Terms

- **Harness:** an agent runtime this repository configures: pi or OMP.
- **Component:** one of the three top-level source trees: `agent-config/`,
  `pi-config/` or `omp-config/`.
- **Shared primitive:** a harness-neutral skill, guidance section, launcher or
  deploy mechanism owned once in `agent-config/` and selected by each harness.
- **Guidance section:** a Markdown file in `agent-config/guidance/` that an
  installer splices into a harness's global `AGENTS.md` at the marker line.
- **Composed guidance:** the deployed global `AGENTS.md`: a harness intro plus
  its selected sections. It is generated; never edit the deployed copy.
- **Launcher:** an executable deployed to `~/.local/bin` from
  `agent-config/bin/` (`pass-env`, `design-check`, `foundation-check`, `ws`).
- **Selection:** the skills, guidance sections, launchers and components a
  harness installer declares for deployment.
- **Deploy (install):** a live mutation of an agent directory and `~/.local/bin`.
  It is never verification.
- **Foundation Standard:** the versioned obligation catalog in
  `agent-config/skills/foundation/`. `foundation-check` enforces it, and a
  project repository pins a harness revision to adopt it.
- **Constitution:** the canonical short statement of the foundations,
  `agent-config/skills/foundation/constitution.md` (ADR-006). The catalog
  holds the normative obligations behind it.
- **Invariants ledger:** the `## Invariants` section of a repository's
  `DOMAIN.md`: every rule specific to that repository, each naming its check or
  marked `unenforced` (ADR-004 amendment, ADR-006).
- **Adoption record:** a project's `foundation.json`, which pins the catalog
  and records a disposition for every obligation.
- **Gap, baseline:** a named deficiency (`doc:…`, `map:…`, `walk:US-…`), and
  the dated list of gaps that ratchet mode tolerates until each expires.
- **Designated agent reviewer:** the GitHub App whose approval alone admits a
  repository's first stories or a baseline extension (ADR-003).

## Owns and delegates

This repository owns the source of agent configuration for both harnesses and
the Foundation Standard tooling. It does not own:

- runtime state, sessions, logs, or authentication files in agent directories,
  which installers preserve;
- credential values, which live in the pass store; this repository holds entry
  names only;
- deployed copies, which installers generate from source;
- a project's foundations: each repository owns its adoption record, stories,
  walk runner and gate, and this repository supplies the checker;
- work status, which lives in Linear.

## Invariants

- **INV-001** Shared launchers deploy byte-identical to source and executable.
  Enforced by `scripts/verify-installers`.
- **INV-002** Installers preserve foreign skills, settings and authentication
  files. Enforced by `scripts/verify-installers`.
- **INV-003** Deployed composed guidance equals the intro plus the selected
  sections. Enforced by `scripts/verify-installers`.
- **INV-004** The installed `foundation-check` fails closed on a repository
  without `foundation.json`. Enforced by `scripts/verify-installers`.
- **INV-005** Relative Markdown links resolve inside the tree. Enforced by
  `scripts/references.test.ts`.
- **INV-006** No secret reaches the remote. Enforced by the pre-push gitleaks
  and trufflehog scan (`.githooks/pre-push`, wired by `scripts/bootstrap`).
- **INV-007** `USER_STORIES.md` passes `check-stories.sh`. `unenforced`: no
  check runs it on this repository.

## Code map

- `agent-config/`: shared primitives (skills, guidance sections, launchers),
  the shared installer, the audio sandbox, System One (`system-one/`), and
  candidate tools not yet deployed (`candidates/`).
- `docs/`: cross-component decisions (`docs/adr/`), verification and migration
  records, and token-efficiency measurements.
- `omp-config/`: OMP routing, config and MCP, extensions, themes, guidance
  intro, watchdog, and its installer.
- `pi-config/`: pi settings, extensions, chrome, guidance intro, its component
  decisions (`pi-config/docs/adr/`), and its installer.
- `scripts/`: workspace bootstrap, the fixed `check` gate entry point and the
  canonical `verify` checks it runs, the isolated installer checks, and the
  workspace inventory.
