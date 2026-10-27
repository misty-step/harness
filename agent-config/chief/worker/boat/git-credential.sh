#!/usr/bin/env bash
set +x
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
token_file="$HOME/.config/kaylee/github-token"
[[ -s "$token_file" ]] || { printf 'kaylee: missing runtime GitHub token\n' >&2; exit 1; }
export GH_TOKEN
GH_TOKEN=$(< "$token_file")
exec gh auth git-credential "$@"
