---
name: setup-mistystack
description: "When installing or refreshing mistystack, or assigning native model, reasoning or rigor settings for the active harness."
metadata:
  owner: phaedrus
  prevents: "Model choices duplicated in method prose, setup written to the wrong harness, and install readback mistaken for live proof; #533 Q2/Q14 and #591."
  source: "cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/setup-pstack/SKILL.md; OMP 18.13.3 config-usage.md, models.md, task-agent-discovery.md; misty-step/mistystack#533 and #591; native adapter notes in skills/misty/harnesses."
  sunset: "2026-11-27"
---

# Setup mistystack

Model and reasoning choices belong in the active harness's native authority, not
a second roster in method prose. One root `skills/` tree and `rules/core.md`
supply the method to every adapter.

1. **Detect.** Establish the active session's harness, native version and target
   profile/home from the runtime itself. An installed executable alone does not
   identify the active harness. If configuring a different destination, name it
   explicitly and keep every operation in that destination's scope. Read the
   matching note before writing:

   | Harness | Native mechanics |
   | --- | --- |
   | OMP | [OMP](../misty/harnesses/omp.md) |
   | Claude Code | [Claude Code](../misty/harnesses/claude.md) |
   | Codex | [Codex](../misty/harnesses/codex.md) |
   | pi | [pi](../misty/harnesses/pi.md) |
   | Grok Bot: Maren or Shipwright | [Grok Bot self-install brief](../misty/harnesses/grok-bot.md) |

   **Complete when:** the runtime, version, destination scope and matching native
   contract are known; Grok-specific mechanisms are established by the bots, not
   inferred from another harness.

2. **Inspect and install.** Read existing native settings, plugin/package state,
   role definitions and relevant project/user overrides. Follow the note's native
   install or refresh path, including any required hook trust. Preserve unrelated
   configuration, agents, plugins, credentials and runtime data; merge owned
   entries instead of replacing whole files. Never copy live credentials into a
   scratch proof home. Inspect the installed artifact after refresh rather than
   assuming the catalog or an unchanged version means the files are current.
   **Complete when:** the intended artifact is installed in the intended scope,
   core/skill wiring is configured, and foreign state is preserved. This is not
   yet live loading proof.

3. **Choose.** Read [roles.md](../ship-loop/roles.md#rigor) for the tier and required
   responsibilities. Inspect the active harness's accessible models, supported
   reasoning levels and existing assignments without exposing credentials. A
   catalog entry or shipped template is not proof of provider entitlement. Keep
   usable existing choices; review template model and reasoning fields against
   the destination account, especially Codex's separately installed TOML agents.
   Carry settled budget choices forward; ask for missing budget or provider
   choices together. pi has no subagents or per-tier agent mappings: choose only
   its main-session model/reasoning settings and perform rigor inline. Grok Bots
   must first establish their native capability and model authority.
   **Complete when:** every applicable native assignment uses an accessible model
   and supported reasoning setting, and the required independent execution path
   is identified rather than simulated with an inline self-review.

4. **Persist through native authority.** Apply and read back only the selected
   harness's owned assignments:

   | Harness | Model/reasoning authority |
   | --- | --- |
   | OMP | Merge `rigor-light`, `rigor-standard` and `rigor-critical` into `modelRoles`; the plugin supplies task agents. Setup writes roles, not agent files. Follow the note's native config commands and check project overrides, same-name agents and `task.agentModelOverrides`. For a new config mechanism, first use the [isolated OMP recipe](agents.md). |
   | Claude Code | Use the native `model` fields of the plugin's `rigor-*` agent definitions. Read back the supplied mappings and any supported native overrides; do not create OMP roles or treat edits to plugin-cache copies as durable configuration. |
   | Codex | Install/reconcile the supplied `rigor-*.toml` definitions in the target `$CODEX_HOME/agents/`, with chosen `model` and `model_reasoning_effort` fields. Preserve `developer_instructions` and unrelated files. Plugin installation alone does not deliver these native custom agents. |
   | pi | Use pi's native main-session model/reasoning configuration; create no rigor-agent files, subagent mappings or OMP roles. |
   | Grok Bot | Use only the model/reasoning authority each bot establishes in its actual runtime; retain the exact native configuration and capability evidence. |

   **Complete when:** native readback matches the chosen assignments and any
   shadowing is resolved explicitly. Readback proves persistence, not provider
   access or successful inference.

5. **Prove a fresh destination session.** Follow the matching note's consumer
   proof. Retain runtime version, candidate revision, install/config results and
   actual events showing the core loaded, installed Misty was discovered/read,
   and its relative bug-fix link reached the installed playbook. Check principle
   discovery policy and explicit reachability separately. Where native rigor
   agents exist, prove their discovery and a short authorized dispatch with actual
   agent/model identity and result. In pi, prove the main-session path instead;
   for Grok Bot, require separate fresh-runtime proof from Maren and Shipwright.
   **Complete when:** the claimed consumer path has observed evidence. Report
   no-model installation and file/config readback as `artifact verified`, not live
   behavior proven; name missing inference, browser or dispatch proof explicitly.

Re-running setup reconciles the same owned native entries. Retire an entry only
after its callers migrate; never remove unrelated configuration or credentials.
