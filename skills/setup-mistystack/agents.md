# Role-backed OMP agents

Source: OMP 18.13.3 [task agent discovery](omp://task-agent-discovery.md). The role inventory and responsibilities live in `skill://ship-loop/roles.md`.

For each required role, write `<agent-dir>/agents/<role-name>.md`, where `<agent-dir>` is the output of `omp config path`. Substitute the actual role name in all three places:

```markdown
---
name: <role-name>
description: Perform the mistystack <role-name> assignment.
model: "@<role-name>"
---

Read skill://ship-loop/roles.md and perform only this role's assigned work.
Use its evidence and completion requirements. Return observed evidence and
specific blockers; label claims measured, inferred or guess.
```

The agent's `model` is a role alias, never a concrete model. Leave tools unspecified so OMP supplies the normal toolset; the assigned role's contract determines what it may change. Reconcile existing same-name definitions instead of overwriting user work. Check project agents too: a project definition with the same name takes precedence over the user definition. Check `task.agentModelOverrides`, which takes precedence over agent frontmatter; preserve unrelated entries and make any entry for these agents point to the same role alias.

After updating files, open OMP's `/agents` hub in the intended project and profile. Dispatch a worker with the role name as its `agent`, for example `agent: light-judge`. OMP resolves the agent's `@light-judge` alias through `modelRoles`. Ordinary task workers have no per-call model override; the `model` argument exposed for historical-session consults is not worker routing.

## Isolated config proof

Run this recipe from a scratch working directory, outside a project. It changes no live OMP state. `MERGED_MODEL_ROLES_JSON` contains the complete chosen mapping, serialized as JSON during setup; these are user choices, not method defaults.

```sh
scratch=$(mktemp -d "${TMPDIR:-/tmp}/mistystack-setup.XXXXXX")
(
  unset OMP_PROFILE PI_PROFILE
  export HOME="$scratch" PI_CONFIG_DIR=.omp
  export PI_CODING_AGENT_DIR="$scratch/.omp/agent" TMPDIR="$scratch/tmp"
  export XDG_DATA_HOME="$scratch/data" XDG_CACHE_HOME="$scratch/cache"
  export XDG_STATE_HOME="$scratch/state" XDG_CONFIG_HOME="$scratch/config"
  mkdir -p "$TMPDIR" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" \
    "$XDG_STATE_HOME" "$XDG_CONFIG_HOME"
  cd "$scratch"
  test "$(omp config path)" = "$scratch/.omp/agent" || exit 1
  # JSON serialization must escape the chosen selector; do not interpolate
  # arbitrary user text into a shell command. Supply the merged JSON from setup.
  omp config set modelRoles "$MERGED_MODEL_ROLES_JSON"
  omp config get modelRoles --json
  omp config list --scope global --json
)
```

Compare the returned roles and the generated `<scratch>/.omp/agent/config.yml` with the supplied JSON. Retain the command, exit status and resulting mapping in the PR or setup report. A successful round trip proves the config mechanism only; test provider access and task dispatch separately under their own authorization. The isolated directory has no live credentials by design.
