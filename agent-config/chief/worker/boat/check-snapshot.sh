#!/usr/bin/env bash
set +x
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
fail() { printf 'snapshot check: %s\n' "$*" >&2; exit 1; }
shopt -s nullglob
for path in \
  "$HOME/.config/kaylee/gateway-token" "$HOME/.config/kaylee/github-token" \
  "$HOME/.config/kaylee/boat-api-key" "$HOME/.config/gh/hosts.yml" \
  "$HOME/.git-credentials" \
  "$HOME/.netrc" "$HOME/.npmrc" "$HOME/.claude/.credentials.json" \
  "$HOME/.codex/auth.json" "$HOME/.aws/credentials" \
  "$HOME/.config/gcloud/application_default_credentials.json" \
  "$HOME/.omp/agent/agent.db" "$HOME/.omp/agent/auth.json" \
  "$HOME/.omp/auth-broker.token" "$HOME/.omp/auth-gateway.token" \
  "$HOME/.ssh"/id_*; do
  [[ "$path" == *.pub ]] && continue
  [[ ! -e "$path" ]] || fail "unexpected credential path: $path"
done
# --no-env still generates a neutral Boat CLI config; only these public keys may exist.
if [[ -e "$HOME/.config/ascii/boat/config.json" ]]; then
  jq -e 'keys - ["api_url", "channel"] | length == 0' "$HOME/.config/ascii/boat/config.json" >/dev/null \
    || fail 'Boat config contains more than neutral api_url/channel settings'
fi
for variable in OMP_AUTH_BROKER_URL OMP_AUTH_BROKER_TOKEN GH_TOKEN GITHUB_TOKEN \
  ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY CLAUDE_CODE_OAUTH_TOKEN \
  WORKER_GATEWAY_KEY BOAT_API_KEY; do
  [[ -z "${!variable:-}" ]] || fail "unexpected credential environment variable: $variable"
done
unexpected=$(find "$HOME/.omp" -type f \
  ! -path "$HOME/.omp/agent/skills/*" \
  ! -path "$HOME/.omp/agent/AGENTS.md" \
  ! -path "$HOME/.omp/agent/models.yml" \
  ! -path "$HOME/.omp/agent/config.yml" -print)
[[ -z "$unexpected" ]] || fail "unexpected OMP state: $unexpected"
[[ ! -d "$HOME/run" ]] || fail 'a run directory was baked in'
expected=$(jq -er '.ompVersion' "$HOME/.config/kaylee/worker-build.json")
[[ "$(omp --version)" == "$expected" ]] || fail 'OMP version differs from factory'
[[ "$(sha256sum "$HOME/.local/bin/omp" | cut -d ' ' -f 1)" == \
  "$(jq -er '.ompSha256' "$HOME/.config/kaylee/worker-build.json")" ]] || fail 'OMP binary differs from factory'
[[ "$(sha256sum "$HOME/.omp/agent/AGENTS.md" | cut -d ' ' -f 1)" == \
  "$(jq -er '.agentsSha256' "$HOME/.config/kaylee/worker-build.json")" ]] || fail 'worker guidance differs from build input'
printf 'PASS: no credential files, provider secrets, broker access, sessions, or caches copied into OMP config\n'
printf 'PASS: factory OMP binary/version and build-time worker guidance match\n'
printf 'NOTE: Boat supplies its sandbox-local ASCII_TOKEN for port hosting; no owner credentials are passed (--no-env)\n'
jq '{ompVersion,ompSha256,agentsSha256,skillsSource,skillsCount,gitName,gitEmail,builtAt}' \
  "$HOME/.config/kaylee/worker-build.json"
