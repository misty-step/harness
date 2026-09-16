# agent-config

Shared, harness-neutral agent primitives for the Misty Step harnesses. It is the
base layer under [pi-config](https://github.com/misty-step/pi-config) and
[omp-config](https://github.com/misty-step/omp-config): portable skills, shared
global guidance, and the `pass-env` secret launcher live here once, and each
harness declares which primitives it selects.

A primitive belongs here only if it is harness-neutral and either duplicated
across harnesses or consumed by more than one. Model routing, trackers, settings,
extensions, themes, and vehicle pointers are harness policy and stay in the
harness repo. When in doubt, leave it in the harness.

## Layout

| Path | Purpose |
| --- | --- |
| `install` | The single deploy contract: skills, guidance, and launchers |
| `skills/` | Portable skill packages, clean-replaced when selected |
| `guidance/*.md` | Shared global-guidance sections, spliced at the harness marker |
| `bin/pass-env.ts` | Standalone pass-backed environment launcher |
| `.githooks/pre-push` | Secret scanners for this repo's own pushes |

## Install contract

Harness installers invoke one CLI and declare their selection. Preflight
validates the whole selection before any write; unknown names, empty sources, an
invalid launcher, a foreign launcher destination, and a missing guidance marker
all fail closed.

```sh
./install --check --agent-dir DIR \
  --skill all \
  --bin pass-env.ts \
  --guidance pokayoke --guidance communication-and-verification --guidance host-resources \
  --guidance-source ../pi-config/global/AGENTS.md
```

Drop `--check` to deploy. `--skill all` selects every package; name packages
individually for a narrower set. `--home` overrides `$HOME` for `~/.local/bin`.

### Guidance composition

Each guidance file is a complete `##` section. The harness guidance file carries
the insertion marker:

```markdown
<!-- shared guidance: agent-config -->
```

`./install` replaces that line with the selected sections, in the order given,
and leaves the rest of the harness file — its title, intro, and vehicle-specific
sections — untouched. The marker is required; its absence aborts the deploy.
Section text stays harness-neutral: vehicle pointers belong in the harness file.

## What each harness selects

| Harness | Skills | Guidance | Launcher |
| --- | --- | --- | --- |
| `pi-config` | all | pokayoke, communication-and-verification, host-resources | `pass-env` |
| `omp-config` | all | pokayoke, communication-and-verification, host-resources | `pass-env` |

`omp-config`'s own guidance file adds Working together (including model roles),
Execution environments (exe.dev and `dev-exec.slice` vehicles), and Authority
and operations. `pi-config`'s file is title and intro only.

## Not yet here

Single-owner or repo-local pieces that stay with their harness for now:

- `omp-config/references/` — host docs (`dev-exec.md`, `scratch-routing.md`).
- `omp-config/bin/tmp-health.py` — workstation pressure monitor.
- `pi-config/bin/linear.ts` — pi's Linear client.
- The pre-push hook is repo-local and stays with each repo.

Each is a candidate to move when a second harness consumes it.

## Verification

```sh
sh -n install
bun test bin/
```

Compose a harness file into a temporary directory and diff it against the live
deployed file before trusting a change to shared guidance.

## Ecosystem

Release automation is [Landmark](https://github.com/misty-step/landmark);
conventional commits become semantic versions and release notes. Pre-push runs
gitleaks and trufflehog. `origin` is `misty-step/agent-config`.
