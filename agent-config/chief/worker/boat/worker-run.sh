#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
run="$HOME/run"
[[ -d "$run" ]] || { printf 'kaylee: missing run directory\n' >&2; exit 1; }
exec 9>> "$HOME/.config/kaylee/worker-run.lock"
flock -n 9 || { printf 'kaylee: this worker run is already active\n' >&2; exit 75; }
[[ ! -e "$run/started-at" && ! -e "$run/exit-code" ]] \
  || { printf 'kaylee: this worker run has already started; refusing to overwrite it\n' >&2; exit 75; }
record_exit() {
  local code=$?
  trap - EXIT
  printf '%s\n' "$code" > "$run/exit-code.tmp"
  mv "$run/exit-code.tmp" "$run/exit-code"
}
trap record_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
[[ -d "$run" && -s "$run/metadata.json" && -s "$run/brief.md" ]]
[[ -s "$HOME/.config/kaylee/gateway-token" && -s "$HOME/.config/kaylee/github-token" ]]
[[ -z "${OMP_AUTH_BROKER_URL:-}" ]] || { printf 'Broker access is forbidden on workers\n' >&2; exit 1; }
export GH_TOKEN
GH_TOKEN=$(< "$HOME/.config/kaylee/github-token")
model=$(jq -er '.model' "$run/metadata.json")
thinking=$(jq -er '.thinking' "$run/metadata.json")
printf '%s\n' "$$" > "$run/runner.pid"
printf '%s\n' "$(date -u +%FT%TZ)" > "$run/started-at"
# Scratch lives outside ~/run: the dispatcher collects only report files from it.
mkdir -p "$HOME/scratch"
export TMPDIR="$HOME/scratch"
cd "$HOME/work/repo"
# A worker cannot fan out more agents on its VM. Kaylee commissions other VMs.
omp -p --mode json --model "$model" --smol "$model" --slow "$model" --plan "$model" \
  --thinking "$thinking" --no-title --wait-async --approval-mode yolo \
  --tools read,bash,edit,write,grep,glob,lsp,eval,ast_edit,debug,todo,web_search \
  --session-dir "$run/sessions" "@$run/brief.md" \
  > "$run/worker.jsonl" 2> "$run/worker.stderr"
