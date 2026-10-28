# mistystack domain

Consumer contracts live in [USER_STORIES.md](USER_STORIES.md), maintainers route
through [AGENTS.md](AGENTS.md), and boundary decisions live in
[docs/decisions/](docs/decisions/index.md).

## Terms

- **Plugin:** the OMP-discovered unit of rules, skills and task agents installed
  from the mistystack marketplace. This repository owns the method plugin.
- **Core rule:** `rules/core.md`, the always-applied entry point and guardrails
  for every session in which the plugin is enabled.
- **Mode:** `misty`, the skill that routes nontrivial work to the relevant
  principles, playbook and task skills.
- **Principle leaf:** one on-demand `principle-<slug>` skill reached through the
  mode's index; the principle has no second always-loaded copy.
- **Playbook:** a numbered task-type procedure under `skills/misty/playbooks/`
  whose steps have checkable completion criteria.
- **Skill:** a directory with a `SKILL.md` entry point and optional supporting
  material, reached as `skill://<name>`.
- **Rigor role:** one of `rigor-light`, `rigor-standard` and `rigor-critical`.
  `setup-mistystack` assigns its model and reasoning budget in OMP config.
- **Task agent:** a plugin-shipped agent selected by OMP's `task` tool. The three
  role-backed agents have the same names as their rigor roles; the brief sets
  the responsibility and OMP config resolves the model.
- **Oracle:** a check outside the worker that can disprove completion, named in
  the brief with the exact command or real user path. A brief without an Oracle
  returns to shaping rather than dispatch.
- **Workstation plugin:** the separate private `misty-step/workstation` plugin
  for fleet machinery, host configuration, credentials, audio, backup and Kaylee.
  It consumes the method without owning a copy of it.

## Invariants

1. **Small, always-on core.** `rules/core.md` is at most 20 lines, including
   frontmatter, and declares `alwaysApply: true`. Procedures load on demand.
2. **Skill provenance.** Every skill follows the frontmatter convention below.
   `metadata.source` covers its whole directory, including supporting files;
   preserve required license notices alongside derived material.
3. **OMP only.** Native OMP manifests, config, discovery and `task` dispatch own
   the runtime contract. This plugin ships no adapters for other clients.
4. **One home per fact.** Core rules, principles, procedures, model assignments,
   consumer stories and historical decisions each have one authority. References
   point there; cutovers migrate callers and remove the old home.
5. **Owned boundary.** Plugin verification uses an isolated home. Installation
   does not replace foreign configuration, credentials or runtime state.

## Skill frontmatter

```yaml
---
name: <directory name>
description: "When to use it; trigger first."
metadata:
  owner: phaedrus
  prevents: "The observed failure this skill prevents."
  source: "Ruling or upstream repo@commit/path; covers the directory."
  sunset: 2026-11-27
---
```

Principle leaves use `disable-model-invocation: true` so the mode's index owns
their routing. Model selectors and reasoning budgets belong only to OMP config,
not to method prose or task-agent prompts.
