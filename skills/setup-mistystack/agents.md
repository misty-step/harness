# Isolated OMP config proof

Use this OMP-only recipe for [setup-mistystack](SKILL.md). Other harnesses use
their matching native-adapter note; this recipe does not prove their configuration
or runtime loading.

Source: OMP 18.13.3 [configuration](omp://config-usage.md). Setup writes the `rigor-light`, `rigor-standard` and `rigor-critical` model roles; the plugin supplies their task agents.

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

Compare the returned roles and the generated `<scratch>/.omp/agent/config.yml` with the supplied JSON. Retain the command, exit status and resulting mapping on the trail or in the setup report, following the [forge procedure](../misty/entire.md). A successful round trip proves the config mechanism only; test provider access and task dispatch separately under their own authorization. The isolated directory has no live credentials by design.
