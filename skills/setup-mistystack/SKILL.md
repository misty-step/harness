---
name: setup-mistystack
description: "When installing or upgrading mistystack, or changing its models, reasoning budgets or rigor roles in OMP."
metadata:
  owner: phaedrus
  prevents: "Model choices duplicated in method prose and setup written to the wrong harness; OMP-only decision #533 Q2/Q14."
  source: "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/setup-pstack/SKILL.md; OMP 18.13.3 config-usage.md, models.md, task-agent-discovery.md; #533"
  sunset: "2026-11-27"
---

# Setup mistystack

Model choices live only in OMP's own `modelRoles` configuration. Method skills refer to roles, never model names. Use [OMP configuration](omp://config-usage.md), [model roles](omp://models.md) and [role-backed agents](omp://task-agent-discovery.md) for the installed version's contract.

1. **Locate.** Run `omp --version` and `omp config path` in the intended profile. Read its existing `config.yml` (or existing `config.yaml`), `omp config get modelRoles --json`, and `omp plugin list`. Preserve unrelated settings, roles, agents, credentials and runtime data. A named profile isolates its own configuration; keep using that profile for every setup command.
2. **Install or upgrade.** For a new install:
   ```sh
   omp plugin marketplace add misty-step/mistystack
   omp plugin install --scope user mistystack@mistystack
   ```
   For an existing install:
   ```sh
   omp plugin marketplace update mistystack
   omp plugin install --force --scope user mistystack@mistystack
   ```
   Catalog refresh alone does not upgrade installed files; the forced install refreshes content even when the catalog version is unchanged. Confirm `omp plugin list` names the enabled user-scope install.
3. **Choose.** Read [roles.md](../ship-loop/roles.md) for the rigor tiers and responsibilities. Setup assigns exactly three `modelRoles` keys: `rigor-light`, `rigor-standard`, `rigor-critical`. The plugin ships the matching task agents; their briefs supply each worker's responsibility. Enumerate accessible models with `omp models --json` and inspect current authentication in OMP's provider/account UI without exposing credentials. A catalog entry alone is not proof of entitlement. Keep usable existing assignments. Ask for the desired budget and any missing choices together, then show the three tier/model/reasoning assignments for acceptance. Choose concrete selectors only from models whose access is confirmed; choose reasoning levels the selected model supports. An alias to an existing configured role is valid if it resolves to one such model. Spend changes or new credentials still require owner approval.
4. **Write config.** Merge the chosen entries into the existing `modelRoles` object, preserving other entries. Run `omp config set modelRoles '<merged JSON object>'`; the CLI schema validates and writes the active profile's global config. Do not replace the config file or write model mappings into rules, agent prompts or this plugin. Use concrete `provider/model` selectors with supported thinking suffixes in config; aliases in YAML must be quoted. Read back with `omp config get modelRoles --json` and inspect `omp config list --scope project --json` for project overrides. Resolve shadowing explicitly rather than claiming the global mapping is effective.
5. **Check agents.** Start a new OMP session and confirm the plugin's `rigor-light`, `rigor-standard` and `rigor-critical` agents appear in `/agents`. Dispatch uses `task` with `agent: <rigor-tier-name>`; a normal worker's model is not a `task.model` parameter. Setup writes only `modelRoles`, not agent files. Check same-name project/user agents and `task.agentModelOverrides` for shadowing; reconcile conflicts explicitly so the selected tier remains the model authority.
6. **Prove.** In a scratch directory, repeat the isolation and config round trip in [agents.md](agents.md) before touching a new configuration mechanism. In the target profile, use a short, authorized fresh-session task to demonstrate the configured tier on the consumer path; retain its actual model identity and result. A config readback proves persistence, not provider access or successful inference. Report measured install/config/dispatch results separately; name anything unverified.

Re-running setup updates the same roles. Retire a role only after its callers have migrated; remove only obsolete mistystack-owned entries, never unrelated configuration.
