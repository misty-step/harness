# Harness domain

Vocabulary, boundaries and invariants for this repository (ADR-004). Intent
lives in [USER_STORIES.md](USER_STORIES.md), decisions in [docs/decisions/](docs/decisions/index.md),
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
  `agent-config/bin/` (`pass-env`, `openrouter-key`).
- **Selection:** the skills, guidance sections, launchers and components a
  harness installer declares for deployment.
- **Deploy (install):** a live mutation of an agent directory and `~/.local/bin`.
  It is never verification.
- **Audited host-install route:** Workbench's typed user socket. Selected-asset
  recipes own reviewed-green admission, transactions and guarded rollback.
  Repository installs own exact merged-default-branch admission, fixed existing
  Harness/ai-usage installer execution and live managed-code readback. OMP owns
  the client and cage exposure. Neither accepts caller commands or auth changes.

## Owns and delegates

This repository owns agent configuration source for both harnesses. It does not own:

- runtime state, sessions, logs, or authentication files in agent directories,
  which installers preserve;
- credential values, which live in the pass store; this repository holds entry
  names only;
- deployed copies, which installers generate from source;
- work status, which lives in the project's existing work authority.

## Invariants

- **INV-001** Shared launchers deploy byte-identical to source and executable.
  Enforced by `scripts/verify-installers`.
- **INV-002** Installers preserve foreign skills, settings and authentication
  files. Enforced by `scripts/verify-installers`.
- **INV-003** Deployed composed guidance equals the intro plus the selected
  sections. Enforced by `scripts/verify-installers`.
- **INV-006** No secret reaches the remote. Enforced by the pre-push gitleaks
  and trufflehog scan (`.githooks/pre-push`, wired by `scripts/bootstrap`).
- **INV-011 — retired:** The custom session landing/lease gate was removed with
  US-004 automation. Native Git/SSH facts and explicit user authorization govern
  owned cleanup; foreign work and durable task evidence must be preserved.
- **INV-013** The host-install client cannot submit a shell, caller environment,
  destination or source-proof object. Selected-asset installation cannot activate
  consumers; the fixed ai-usage repository installer uses its supported plugin
  rescan without activating the collector or restarting OMP/Pi.
  Enforced by `omp-config/bin/omp-host-install.py` and
  `omp-config/bin/test_omp_host_install.py`; Workbench enforces the host boundary.
  Native installation is also available directly through the scoped installers.

## Code map

- `agent-config/`: shared primitives (skills, guidance sections, launchers),
  the shared installer, the audio sandbox, and session backup.
- `docs/`: cross-component decisions (`docs/decisions/`), principles, the
  primitives map (`docs/architecture/primitives.yaml`), verification and
  migration records, and token-efficiency measurements.
- `omp-config/`: OMP routing, config and MCP, extensions, themes, guidance
  intro and installer.
- `pi-config/`: pi settings, extensions, chrome, guidance intro, its component
  decisions (`pi-config/docs/decisions/`), and its installer.
- `scripts/`: workspace bootstrap, the fixed `check` gate entry point and the
  canonical `verify` checks it runs, the isolated installer checks, and the
  workspace inventory.
