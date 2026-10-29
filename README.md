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

Install and refresh through the matching native reference:

- [OMP](skills/misty/harnesses/omp.md): marketplace plugin and role-backed agents.
- [Claude Code](skills/misty/harnesses/claude.md): marketplace plugin, core hook and native agents.
- [Codex](skills/misty/harnesses/codex.md): marketplace plugin, core hook and user-installed agent templates.
- [pi](skills/misty/harnesses/pi.md): Git package and core extension; rigor runs inline.
- [Grok Bot runtime](skills/misty/harnesses/grok-bot.md): each bot installs from a brief and establishes its loading proof.

Kaylee's Hermes already consumes the shared tree. Grok Build CLI is not a target;
there is no `.grok-plugin` adapter. Runtime and credential setup remain in the
private workstation repository.

## Layout

```text
.omp-plugin/       OMP plugin and marketplace
.claude-plugin/    Claude Code plugin and marketplace
.codex-plugin/     Codex plugin
.agents/plugins/   Codex marketplace
package.json       pi package resource declarations
rules/core.md      always-on routing and guardrails
skills/misty/      mode, principle index and task playbooks
skills/misty/harnesses/ disclosed native integration references
skills/principle-* on-demand principle leaves
skills/            one Agent Skills content tree
adapters/          harness-specific agents, hooks and extensions
agents/            OMP agents at its fixed native discovery path
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
Markdown link resolution, named skill references, URI isolation and native
manifests; installation is explicitly unproved. The full `plugin --strict`
selection installs in disposable homes through every available OMP, Claude Code,
Codex and pi CLI. Missing CLIs are named as skipped, not passed. OMP also inspects
the loaded core and skill list without inference; other no-model checks prove
native installation, skill inventory and core hook/extension registration, not
live model behavior. See the harness notes for fresh-session proof,
`./scripts/check --help` for gate options and
[verify-mistystack](.agents/skills/verify-mistystack/SKILL.md) for the complete
evidence contract. No check installs into an operator's live profile.

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
