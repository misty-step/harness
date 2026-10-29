# mistystack

Misty Step's harness-neutral engineering method. One content tree uses the open
Agent Skills format, `skills/<name>/SKILL.md`; thin native adapters from this
repository connect it to a harness without copying the method or adding a custom
installer. A small always-on core routes nontrivial work through
[misty](skills/misty/SKILL.md); principles, playbooks and skills load when the task
needs them. An Oracle names the outside check that makes completion observable
before work starts.

Fleet machinery lives in the private `misty-step/workstation` repository.

## Harness support

OMP shipped first. Its installation, refresh, configuration and consumer-proof
mechanics have one home in the [OMP reference](skills/misty/harnesses/omp.md).
Claude Code, Codex, pi, Grok Build and Hermes adapters and their proofs are tracked
by [#591](https://github.com/misty-step/mistystack/issues/591); this documentation
cutover does not claim those native integrations have shipped.

## Layout

```text
.omp-plugin/       OMP's native plugin and marketplace manifests
rules/core.md      always-on routing and guardrails
skills/misty/      mode, principle index and task playbooks
skills/misty/harnesses/ disclosed native integration references
skills/principle-* on-demand principle leaves
skills/            one Agent Skills content tree
agents/            native adapter role agents
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
`./scripts/check plugin --strict --lint-only`: strict lint checks relative
Markdown link resolution, named skill references and URI isolation; installation
is explicitly unproved. The full `plugin --strict` selection also runs the
current OMP consumer proof. It requires OMP and proves only that adapter, not
support for another harness. See the [OMP reference](skills/misty/harnesses/omp.md)
for its mechanics, `./scripts/check --help` for gate options and
[verify-mistystack](.agents/skills/verify-mistystack/SKILL.md) for the repository's
verification contract. No check installs into the operator's live profile.

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
