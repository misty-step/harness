#!/bin/sh
# Run one task headless on raw Pi, with or without the s1s2 System 1 layer (US-029).
#
# Usage: run.sh <repo-dir> <prompt-file> <out-dir>
#   S1S2_ARM       s1s2 (default) or raw (stock Pi control: no extension)
#   S1S2_PROVIDER  default openrouter
#   S1S2_MODEL     default anthropic/claude-opus-5.5
#   S1S2_THINKING  default medium
#
# Raw Pi means: an empty agent directory (no operator settings, guidance,
# extensions, skills, or prompt templates); the repository's own context files
# still load. OPENROUTER_API_KEY must be in the environment; it is never written.
set -eu
[ "$#" -eq 3 ] || { echo 'usage: run.sh <repo-dir> <prompt-file> <out-dir>' >&2; exit 2; }
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$1" && pwd)
prompt=$(cat "$2")
out=$3
arm=${S1S2_ARM:-s1s2}
provider=${S1S2_PROVIDER:-openrouter}
model=${S1S2_MODEL:-anthropic/claude-opus-5.5}
thinking=${S1S2_THINKING:-medium}
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required}"
[ ! -e "$out" ] || { echo "refusing to reuse $out" >&2; exit 2; }
case "$arm" in
  s1s2) set -- -e "$here/index.ts" ;;
  raw) set -- ;;
  *) echo "unknown S1S2_ARM: $arm" >&2; exit 2 ;;
esac
mkdir -p "$out/agent" "$out/sessions" "$out/s1"
out=$(CDPATH= cd -- "$out" && pwd)
head=$(git -C "$repo" rev-parse HEAD)
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
start_ms=$(date +%s%3N)
set +e
(cd "$repo" && PI_CODING_AGENT_DIR="$out/agent" S1S2_RUN_DIR="$out/s1" \
  pi --mode json --no-extensions "$@" --no-skills --no-prompt-templates \
    --provider "$provider" --model "$model" --thinking "$thinking" \
    --session-dir "$out/sessions" -p "$prompt") >"$out/events.jsonl" 2>"$out/stderr.log"
status=$?
set -e
end_ms=$(date +%s%3N)
# Final deliverable, untracked files included, without touching the repository index.
GIT_INDEX_FILE="$out/git-index" git -C "$repo" read-tree HEAD
GIT_INDEX_FILE="$out/git-index" git -C "$repo" add -A
GIT_INDEX_FILE="$out/git-index" git -C "$repo" diff --cached --binary HEAD >"$out/final.diff"
rm -f "$out/git-index"
printf '{"arm":"%s","provider":"%s","model":"%s","thinking":"%s","pi":"%s","repo_head":"%s","started_at":"%s","wall_ms":%s,"exit":%s}\n' \
  "$arm" "$provider" "$model" "$thinking" "$(pi --version)" "$head" "$started" "$((end_ms - start_ms))" "$status" >"$out/run.json"
exit "$status"
