# OMP mechanics

Use this reference when running Mistystack in OMP. The method lives in the same
Agent Skills tree used by other harnesses; this file owns OMP's native mechanics.

## Install and refresh

With [OMP](https://github.com/can1357/oh-my-pi) installed, add the marketplace and
install at user scope:

```sh
omp plugin marketplace add misty-step/mistystack
omp plugin install --scope user mistystack@mistystack
```

For an existing install:

```sh
omp plugin marketplace update mistystack
omp plugin install --force --scope user mistystack@mistystack
```

Catalog refresh alone does not upgrade installed files. The forced install
refreshes content even when the catalog version is unchanged. Confirm the enabled
user-scope install with `omp plugin list`, then start a fresh OMP session. Use the
[setup-mistystack](../../setup-mistystack/SKILL.md) skill to assign models and
reasoning budgets; credentials stay in OMP's credential system. Preserve foreign
plugins, configuration, credentials and runtime data.

## Local environment

Misty Step's operator develops locally in OMP inside Tern, a multiplexing
terminal whose daemon keeps sessions alive between windows
([ADR 0017](../../../docs/decisions/0017-tern-omp-and-boat-workers.md)). Local OMP
sessions work there. For an
explicit request to open, split or drive panes, read `tern help` and the
command's `--help`, target blocks by the IDs Tern returns, and leave the
operator's focused block and sessions you did not create intact.

## Read skills and relative links

OMP's `read` tool accepts `skill://misty` and `skill://<name>` for installed skills.
A relative Markdown link is relative to the file containing it, not the session's
working directory. Follow Misty's [bug-fix routing link](../playbooks/bug-fix.md)
to that installed file; a checkout copy is not proof of installed content.

Principle leaves retain `disable-model-invocation: true`: OMP omits them from its
automatic model skill list, while explicit reads still reach them. Routers stay
model-discoverable. Confirm the installed version's invocation behavior before
relying on a metadata flag. Discovery and explicit leaf reachability are separate
consumer checks.

OMP loads `rules/core.md` through `alwaysApply: true`. The root package's explicit
empty `omp` manifest prevents OMP's package loader from falling back to `pi` and
loading pi's core extension a second time.

## Dispatch and rigor

Dispatch independent units with OMP's `task` tool. Pass the briefing contract in
the [misty](../SKILL.md) skill, not the parent transcript. Give writers isolated
worktrees and one branch each; keep shared resources single-writer. The method's
[rigor tiers and responsibilities](../../ship-loop/roles.md#rigor) decide the
review shape, not a model roster in a prompt.

OMP 18.13.3 ignores a manifest `agents` array and scans root `agents/`, so the
OMP-native agent files must remain at that fixed root.

The plugin supplies [rigor-light](../../../agents/rigor-light.md),
[rigor-standard](../../../agents/rigor-standard.md) and
[rigor-critical](../../../agents/rigor-critical.md). Select `rigor-<tier>` in each
task's `agent` field. The worker's model comes from the matching OMP `modelRoles`
key, not a `task.model` parameter. The brief selects builder, QA/review, judge,
fix-builder, recheck or final-judge; using the same tier does not waive independent
threads. For source-only security work, use `scout` for read-only reconnaissance
and critics, and `security-reviewer` for source/local hunting and verification.

Setup writes only `modelRoles`, not agent files. Run `omp config path` in the
intended profile, preserve existing entries, merge chosen mappings with
`omp config set modelRoles '<merged JSON object>'`, then read them back with
`omp config get modelRoles --json`. Inspect project overrides and same-name
project/user agents, including `task.agentModelOverrides`, before claiming a tier
is effective. A new session must discover all three agents in `/agents`. Config
readback proves persistence, not provider entitlement or successful inference.
Consult the installed OMP [configuration](omp://config-usage.md),
[model roles](omp://models.md) and [agent discovery](omp://task-agent-discovery.md)
contracts when configuring a version you have not verified.

## Drive the real UI

Use OMP's browser tool through `eval`. Read its API instructions at
`xd://eval/browser` before first use. Open a dedicated tab, observe and interact
through the actual product login and controls, wait for the expected state, then
capture and inspect it. Do not inject DOM to manufacture success. Emulation proves
only the emulated condition, not physical-device behavior. When the app's
services run on a Boat worker, forward the port as the
[boat-workers](../../boat-workers/SKILL.md) skill describes and drive `localhost`.
The [design review procedure](../../design/review.md) owns state selection and review.

## Prove installation and fresh-session loading

From the source checkout, run `./scripts/check plugin --strict`. The maintained
helper installs the working tree through the native marketplace in an isolated
OMP home and project, refuses an escaping config path before installation, and
starts a fresh RPC session. It checks that the always-on core was injected,
Misty is listed, the installed skill body matches the candidate, and principle
leaves remain explicitly readable while hidden from the automatic list. The
inference-free RPC selector uses the existing `modelRoles.smol` assignment;
`plugin --model SELECTOR` supplies an explicit override. No check installs into
the operator's live profile. A lint-only run does not prove installation.

For changed routing, also ask a fresh isolated session to open the installed
Misty skill, follow its relative bug-fix playbook link and quote the first step.
Retain actual read-tool events and the response with the checked revision. File
presence and a model's self-report alone are not loaded-method proof. For changed
installed skills, rules or extensions, exercise the changed consumer path in a
fresh destination session; report artifact readback without that run as
`artifact verified`, not live behavior proven. The repository's
[verification procedure](../../../.agents/skills/verify-mistystack/SKILL.md) owns
the complete evidence contract.
