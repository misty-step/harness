# mistystack

Misty Step's engineering method, packaged as an OMP plugin. A small always-on
core routes nontrivial work through `misty`; principles, playbooks and skills
load when the task needs them. An Oracle names the outside check that makes
completion observable before work starts.

Fleet machinery lives in the private `misty-step/workstation` repository.

## Install and refresh

With OMP installed:

```sh
omp plugin marketplace add misty-step/mistystack
omp plugin install --scope user mistystack@mistystack
```

For an existing install:

```sh
omp plugin marketplace update mistystack
omp plugin install --force --scope user mistystack@mistystack
```

Start a fresh session, then load `skill://setup-mistystack` to assign models and
reasoning budgets to the three rigor roles. The plugin ships matching task
agents; model choices stay in OMP config. Catalog refresh alone does not update
installed files. See the [setup skill](skills/setup-mistystack/SKILL.md) for the
complete procedure.

## Layout

```text
.omp-plugin/       native plugin and marketplace manifests
rules/core.md      always-on routing and guardrails
skills/misty/      mode, principle index and task playbooks
skills/principle-* on-demand principle leaves
skills/            shaping, delivery, verification, design and setup
agents/            role-backed task agents
.agents/skills/    repository verification
scripts/           checks, Git hook setup and release protection
docs/guide/        human guide
```

Vocabulary and invariants live in [DOMAIN.md](DOMAIN.md); consumer contracts
live in [USER_STORIES.md](USER_STORIES.md). Maintainers start at
[AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Verify

```sh
./scripts/bootstrap
./scripts/check
./scripts/check plugin --strict
```

`check` runs the maintained test suites and plugin lint sequentially. CI runs
`./scripts/check plugin --strict --lint-only`: dangling `skill://` references
fail, and installation is explicitly unproved. The full `plugin --strict`
selection also installs into an isolated OMP home and observes a fresh session;
it requires OMP. Its inference-free RPC proof resolves the configured OMP `smol`
model role; use the plugin-only `--model SELECTOR` option to override it. Run
`./scripts/check --help` for the plugin-only flags and
[verify-mistystack](.agents/skills/verify-mistystack/SKILL.md) for the real consumer
proof. No check installs into the operator's live profile.

## Release

Landmark prepares a generated changelog PR, then publishes only its verified,
landed commit. Keep [CHANGELOG.md](CHANGELOG.md) generated. The shared
[release convention](docs/release-convention.md) stays at its existing path for
external callers.

## Read

- [Guide](docs/guide/): installation and the working method.
- [Foundation checklist](skills/foundation/checklist.md): the audit rubric;
  [FOUNDATIONS.md](FOUNDATIONS.md) is a pointer, not another standard.
- [References](docs/references.md): upstream reading, not installed skill packs.
- [Attribution](ATTRIBUTION.md): sources and license notices.
- [Decisions](docs/decisions/index.md): boundaries and rejected alternatives.
