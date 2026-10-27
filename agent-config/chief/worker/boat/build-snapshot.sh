#!/usr/bin/env bash
# Run on factory from this worktree; the adjacent worker/AGENTS.md is read afresh.
set +x
set -Eeuo pipefail
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export BOAT_NO_UPDATE=1
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
name=omp-worker
identity_repo=${KAYLEE_GIT_IDENTITY_REPO:-$HOME/workspace/harness}
skills=${KAYLEE_OMP_SKILLS:-$HOME/.omp/agent/skills}
for command in boat jq tar sha256sum git omp; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
[[ -s "$source_dir/../AGENTS.md" && -d "$skills" ]]
[[ "$(uname -m)" == x86_64 ]] || { printf 'Build on x86_64 factory, matching Boat\n' >&2; exit 1; }
version=$(omp --version)
omp_binary=$(readlink -f "$(command -v omp)")
git_name=$(git -C "$identity_repo" config --get user.name)
git_email=$(git -C "$identity_repo" config --get user.email)
[[ -n "$git_name" && -n "$git_email" ]]
scratch=$(mktemp -d)
build_id=
check_id=
cleanup() {
  local code=$?
  trap - EXIT
  for id in "$check_id" "$build_id"; do
    [[ -z "$id" ]] || boat delete "$id" --yes --json >/dev/null || {
      printf 'CLEANUP FAILED: boat delete %s --yes is required\n' "$id" >&2
      code=1
    }
  done
  rm -rf -- "$scratch"
  exit "$code"
}
trap cleanup EXIT
trap 'printf "Snapshot build failed at line %s\n" "$LINENO" >&2' ERR
trap 'exit 130' INT
trap 'exit 143' TERM
new_sandbox() {
  local output=$1
  shift
  boat new --no-env --ttl 3600 --type small --json "$@" > "$output"
  jq -ers '[.[] | select(.event == "ready") | .id] | last | select(type == "string" and length > 0)' "$output"
}
# Keep the newly allocated ID even if creation fails after allocating the VM.
if ! build_id=$(new_sandbox "$scratch/build-create.jsonl" --name "kaylee-snapshot-build-$(date +%s)"); then
  build_id=$(jq -rs '[.[] | .id? | select(type == "string" and startswith("bx_"))] | last // empty' "$scratch/build-create.jsonl")
  printf 'Boat build VM creation failed\n' >&2
  cat "$scratch/build-create.jsonl" >&2
  exit 1
fi
printf 'Build sandbox: %s\n' "$build_id"
boat ssh "$build_id" 'umask 077; mkdir -p "$HOME/.local/bin" "$HOME/.omp/agent/skills" "$HOME/.config/kaylee"' >/dev/null
boat scp "$omp_binary" "$build_id:/home/user/.local/bin/omp" >/dev/null
boat scp "$source_dir/../AGENTS.md" "$build_id:/home/user/.omp/agent/AGENTS.md" >/dev/null
boat scp "$source_dir/models.yml" "$build_id:/home/user/.omp/agent/models.yml" >/dev/null
boat scp "$source_dir/config.yml" "$build_id:/home/user/.omp/agent/config.yml" >/dev/null
boat scp "$source_dir/worker-run.sh" "$build_id:/home/user/.local/bin/kaylee-worker-run" >/dev/null
boat scp "$source_dir/git-credential.sh" "$build_id:/home/user/.local/bin/kaylee-git-credential" >/dev/null
boat scp "$source_dir/check-snapshot.sh" "$build_id:/home/user/.local/bin/kaylee-check-snapshot" >/dev/null
# Copy only the shared skill tree, dereferencing its links, never the agent home.
tar -C "$skills" --exclude=.git --exclude=node_modules --exclude=__pycache__ \
  --exclude=.cache --exclude=cache --exclude=sessions --exclude=agent.db --exclude='agent.db-*' \
  --exclude=auth.json --exclude=credentials.json --exclude=.credentials.json --exclude=hosts.yml \
  --exclude=.env --exclude='.env.local' --exclude='*.token' --exclude=.git-credentials \
  --exclude='id_ed25519' --exclude='id_rsa' --dereference -cf - . \
  | boat ssh "$build_id" 'tar -xf - -C "$HOME/.omp/agent/skills"' >/dev/null
jq -n --arg version "$version" --arg sha "$(sha256sum "$omp_binary" | cut -d ' ' -f 1)" \
  --arg agents "$(sha256sum "$source_dir/../AGENTS.md" | cut -d ' ' -f 1)" \
  --arg skills "$skills" --arg gitName "$git_name" --arg gitEmail "$git_email" \
  --arg builtAt "$(date -u +%FT%TZ)" \
  '{ompVersion:$version,ompSha256:$sha,agentsSha256:$agents,skillsSource:$skills,gitName:$gitName,gitEmail:$gitEmail,builtAt:$builtAt}' \
  | boat ssh "$build_id" 'cat > "$HOME/.config/kaylee/worker-build.json"' >/dev/null
boat ssh "$build_id" 'bash -s' <<'SETUP'
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
chmod 0755 "$HOME/.local/bin/omp" "$HOME/.local/bin/kaylee-"*
manifest="$HOME/.config/kaylee/worker-build.json"
skills_count=$(find "$HOME/.omp/agent/skills" -name SKILL.md -type f | wc -l)
jq --argjson count "$skills_count" '. + {skillsCount:$count}' "$manifest" > "$manifest.tmp"
mv "$manifest.tmp" "$manifest"
git config --global user.name "$(jq -er '.gitName' "$manifest")"
git config --global user.email "$(jq -er '.gitEmail' "$manifest")"
git config --global credential.https://github.com.helper '!/home/user/.local/bin/kaylee-git-credential'
git config --global credential.https://gist.github.com.helper '!/home/user/.local/bin/kaylee-git-credential'
rm -f -- "$HOME/.config/ascii/boat/config.json"
kaylee-check-snapshot
SETUP
boat snapshot "$build_id" "$name" --json > "$scratch/saved.json"
for ((attempt=0; attempt<360; attempt++)); do
  boat snapshots --json > "$scratch/snapshots.json"
  status=$(jq -er --arg name "$name" '.named[] | select(.name == $name) | .status' "$scratch/snapshots.json")
  case "$status" in
    ready) break ;;
    failed) jq --arg name "$name" '.named[] | select(.name == $name)' "$scratch/snapshots.json" >&2; exit 1 ;;
    saving) sleep 5 ;;
    *) printf 'Unexpected snapshot status: %s\n' "$status" >&2; exit 1 ;;
  esac
done
[[ "$status" == ready ]] || { printf 'Timed out saving %s\n' "$name" >&2; exit 1; }
jq --arg name "$name" '.named[] | select(.name == $name) | {name,status,snapshotId,sourceSandboxId,createdAt,sizeBytes}' "$scratch/snapshots.json"
if ! check_id=$(new_sandbox "$scratch/check-create.jsonl" --from "$name" --name "kaylee-snapshot-check-$(date +%s)"); then
  check_id=$(jq -rs '[.[] | .id? | select(type == "string" and startswith("bx_"))] | last // empty' "$scratch/check-create.jsonl")
  printf 'Boat fresh-snapshot VM creation failed\n' >&2
  exit 1
fi
printf 'Fresh-snapshot sandbox: %s\n' "$check_id"
boat ssh "$check_id" '/home/user/.local/bin/kaylee-check-snapshot'
printf 'Snapshot %s ready; deleting both scratch sandboxes\n' "$name"
