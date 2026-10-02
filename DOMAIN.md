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
  `DOMAIN.md`: every invariant and review rule for what must hold in that
  repository, each naming its check or marked `unenforced` (ADR-004
  amendment, ADR-006).
- **Adoption record:** a project's `foundation.json`, which pins the catalog
  and records a disposition for every obligation.
- **Gap, baseline:** a named deficiency (`doc:…`, `map:…`, `walk:US-…`), and
  the dated list of gaps that ratchet mode tolerates until each expires.
- **Designated agent reviewer:** the GitHub App whose approval alone admits a
  repository's first stories or a baseline extension (ADR-003).
- **Landing record:** owner-bound repository, canonical checkout, branch and
  last observed HEAD, stored separately from leases and retained after worktree
  removal so merge/teardown obligations cannot disappear with the resource.
- **Landed session:** owned work merged, deployed and sanity-checked with
  PR/ticket evidence, feature branches/worktrees removed, and the canonical
  checkout clean on the fetched origin default head.
- **Parked session:** explicitly unfinished owned work retained with a meaningful
  reason, owner and resume steps; parking permits close but never means done.

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
- work status, which lives in Glass for Misty Step/personal work and Habitat for R90.

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
- **INV-008** Desktop-guard staging cannot alter active user units or desktop
  bindings. Enforced by `agent-config/desktop-guard/test_install.py`.
- **INV-009** Managed fleet launch refuses missing effective bounds, an
  unmanaged server or an oomd monitoring ancestor. Enforced at runtime by
  `agent-config/desktop-guard/desktop-guard.py`; the native owner-path walk is
  documented in `docs/desktop-memory-guard.md`.
- **INV-010** A release candidate passes Landmark's own validation on an
  up-to-date merge candidate before it can land (US-015). `unenforced`: reviewers judge it.
  Why: CI's `verify` runs the validator in `.github/workflows/ci.yml`;
  `scripts/protected-release.test.ts` checks current-base replay.
  Scope: Before an ordinary merge, the agent observes green CI and verifies an
  up-to-date merge candidate against the current default head. GitHub approval
  and required-status merge gates were removed by ADR-003's uniform cutover.
- **INV-011** Sessions close only landed or explicitly parked with a resume note
  (US-004). Deterministic owned Git/GitHub facts and live lease obligations are
  enforced by `agent-config/skills/session-close/session-close.ts check`, with
  regression coverage in
  `agent-config/skills/session-close/session-close.test.ts`. Corrupt storage and
  unparked auth/command failures fail closed; parked facts remain unverified.
  Foreign resources are informational and never cleanup targets.
  `unenforced`: independent exact-head model review, observed green CI, deployment
  to actual targets, production sanity and PR/relevant-ticket evidence remain
  engineer judgment under `agent-config/skills/session-close/SKILL.md`. Parking is
  reported as unfinished and does not waive live non-worktree leases.
- **INV-012** Activated OMP engineer starts are admitted under one launch lock
  and enter a verified 4-GiB/zero-swap/group-OOM leaf before native execution.
  Live cgroups, not launcher PIDs or environment markers, own reservations;
  measured uncaged memory remains visible during natural-restart migration.
  Enforced by `omp-config/bin/omp-engineer.py`, with admission/transition
  coverage in `omp-config/bin/test_omp_engineer.py`. Native Herdr/Glass visibility,
  terminal recovery and actual low-headroom refusal require the recorded live
  rollout walk in addition to these isolated tests.
  Explicit layout activation also requires the installed Workbench updater's
  versioned capability before writes (`omp-config/install`,
  `scripts/verify-installers`; MIS-203).

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
