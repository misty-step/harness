# mistystack domain

Consumer contracts live in [USER_STORIES.md](USER_STORIES.md), maintainers route
through [AGENTS.md](AGENTS.md), and boundary decisions live in
[docs/decisions/](docs/decisions/index.md).

## Terms

- **Content tree:** the canonical method in open Agent Skills format,
  `skills/<name>/SKILL.md`, with supporting files beside each entry point.
- **Native adapter:** thin integration from this repository that exposes the
  content tree through a harness's own loading and configuration mechanisms,
  without a custom installer or a second copy of the method. OMP's plugin is
  the first shipped adapter; others are tracked by
  [#591](https://github.com/misty-step/mistystack/issues/591).
- **Core rule:** `rules/core.md`, the always-applied entry point and guardrails
  for sessions using the method.
- **Mode:** `misty`, the skill that routes nontrivial work to the relevant
  principles, playbook and task skills.
- **Principle leaf:** one on-demand `principle-<slug>` skill reached through the
  mode's index; the principle has no second always-loaded copy.
- **Playbook:** a numbered task-type procedure under `skills/misty/playbooks/`
  whose steps have checkable completion criteria.
- **Skill:** a directory with a `SKILL.md` entry point and optional supporting
  material. References use relative Markdown links or the skill's name; native
  loading mechanics belong to the adapter.
- **Rigor role:** one of `rigor-light`, `rigor-standard` and `rigor-critical`,
  independent of a particular model. Model and reasoning choices belong in
  harness-native configuration.
- **Task agent:** an independent worker given a brief. The brief sets its
  responsibility; the native adapter supplies dispatch and runtime selection.
- **Oracle:** a check outside the worker that can disprove completion, named in
  the brief with the exact command or real user path. A brief without an Oracle
  returns to shaping rather than dispatch.
- **Local development environment:** the operator's OMP running in Tern, as the
  [OMP note](skills/misty/harnesses/omp.md) states. Other harnesses work where
  they run unless their harness note says otherwise.
- **Boat worker:** a fresh Boat sandbox one agent dispatches for one unit's
  execution. The dispatcher keeps its loop and credentials and deletes the
  worker after collecting results; [boat-workers](skills/boat-workers/SKILL.md)
  owns placement and lifecycle.
- **Workstation plugin:** the separate private `misty-step/workstation` plugin
  for fleet machinery, host configuration, credentials, audio and backup.
  It consumes the method without owning a copy of it.

## Invariants

1. **Small, always-on core.** `rules/core.md` is at most 20 lines, including
   frontmatter. Native adapters load the core; procedures load on demand.
2. **Skill provenance.** Every skill follows the frontmatter convention below.
   `metadata.source` covers its whole directory, including supporting files;
   preserve required license notices alongside derived material.
3. **Harness-neutral method.** One content tree owns the method. Harness-specific
   tools, configuration, loading behavior and working environments live in
   disclosed native-adapter references, not shared procedures or the core.
4. **One home per fact.** Core rules, principles, procedures, model assignments,
   consumer stories and historical decisions each have one authority. References
   point there; cutovers migrate callers and remove the old home.
5. **Owned boundary.** Native-adapter verification uses isolated runtime state.
   Installation does not replace foreign configuration, credentials or runtime
   state. Fleet machinery stays in private `misty-step/workstation`.

## Skill frontmatter

```yaml
---
name: <directory name>
description: "When to use it; trigger first."
metadata:
  owner: phaedrus
  prevents: "The observed failure this skill prevents."
  source: "Ruling or upstream repo@commit/path; covers the directory."
  sunset: "2026-11-27"
---
```

Metadata dates remain quoted strings so YAML 1.1 readers such as PyYAML can
serialize the skill as JSON. The plugin lint rejects plain date/timestamp values
and requires a non-empty string for `metadata.sunset`.

Model selectors and reasoning budgets belong in harness-native configuration,
not shared method prose or task-agent prompts. OMP's configuration and invocation
behavior are disclosed in the [OMP reference](skills/misty/harnesses/omp.md).
