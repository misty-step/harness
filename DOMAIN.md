# Harness domain

Vocabulary, boundaries and invariants for this repository (ADR-004). Intent
lives in [USER_STORIES.md](USER_STORIES.md), decisions in [docs/decisions/](docs/decisions/index.md),
and agent rules in [AGENTS.md](AGENTS.md).

## Terms

- **Harness:** an agent runtime this repository configures: pi, OMP, Claude Code or Codex.
- **Component:** a top-level source tree: `agent-config/`, `pi-config/`,
  `omp-config/`, `claude-config/` or `codex-config/`.
- **Shared primitive:** a harness-neutral skill, guidance section, launcher or
  deploy mechanism owned once in `agent-config/` and selected by each harness.
- **Guidance section:** a Markdown file in `agent-config/guidance/` that an
  installer splices into a harness's global guidance file (`AGENTS.md` alone) at the marker line.
- **Composed guidance:** the deployed global guidance file: a harness intro plus
  its selected sections. It is generated; never edit the deployed copy.
- **Launcher:** an executable deployed to `~/.local/bin` from
  `agent-config/bin/` (`pass-env`, `openrouter-key`).
- **Selection:** the skills, guidance sections, launchers and components a
  harness installer declares for deployment.
- **Deploy (install):** a live mutation of an agent directory and `~/.local/bin`.
  It is never verification.
- **Desktop isolation:** separation from the operator's live screen, cursor,
  capture surfaces and input channels; not a prohibition on application management.
- **Application management:** authorized installation, configuration and service
  activation through the application's native owner.
- **Activation:** a running consumer has loaded the intended deployed version;
  installed bytes or an on-disk version command alone do not prove it.
- **Audited host-install route:** Workbench's typed user socket. Selected-asset
  recipes own reviewed-green admission, transactions and guarded rollback.
  Repository installs own exact merged-default-branch admission, fixed native
  Harness/ai-usage/iron-forest/Cantrip owner paths and managed-code/live-state
  readback. OMP owns the client and cage exposure. Neither accepts caller
  commands, source paths, environments or auth changes.

## Owns and delegates

This repository owns agent configuration source for every harness. It does not own:

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
  consumers; repository recipes own only their named application's supported
  lifecycle. The ai-usage installer rescans plugins without activating its
  collector; an explicit Cantrip install uses and preserves its existing startup
  owner. Harness CLI installation may ask only the managed native broker to
  refresh itself when its running executable differs from the installed one.
  None of these paths restarts OMP/Pi or grants operator desktop control.
  Enforced by `omp-config/bin/omp-host-install.py`, `omp-config/install` and
  `omp-config/bin/test_omp_host_install.py`; Workbench enforces the host boundary.
  Native installation is also available directly through the scoped installers.

## Code map

- `agent-config/`: shared primitives (skills, guidance sections, launchers),
  the shared installer, the audio sandbox, and System One (`system-one/`).
- `claude-config/`: Claude Code's skill and guidance selection, its guidance
  intro and installer.
- `codex-config/`: Codex's native defaults (`config.toml`), its skill and
  guidance selection, guidance intro and installer.
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
