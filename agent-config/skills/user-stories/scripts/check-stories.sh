#!/bin/sh
# check-stories.sh — fail-closed validation for a repository's USER_STORIES.md.
#
# Usage: sh check-stories.sh [--tests] [--strict-evidence] [repo-root]
#
# Structure, ids, and supersede/retire targets fail the run. Evidence paths
# warn during bootstrap and fail when foundation-check passes --strict-evidence
# for an enforced adoption. Per-story test coverage remains advisory.
set -eu

tests=0
strict_evidence=0
root=.
while [ $# -gt 0 ]; do
  case "$1" in
    --tests) tests=1 ;;
    --strict-evidence) strict_evidence=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) root=$1 ;;
  esac
  shift
done
cd "$root"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
warn() { printf 'WARN: %s\n' "$1" >&2; }

if [ -d USER_STORIES ]; then
  printf 'FAIL: USER_STORIES/ is not a supported layout; keep one root USER_STORIES.md\n' >&2
  exit 1
fi
if [ ! -f USER_STORIES.md ]; then
  printf 'no USER_STORIES.md at %s — nothing checked\n' "$(pwd)"
  exit 0
fi
files='USER_STORIES.md'

ids=$(grep -hE '^## US-[0-9]{3}( |$)' $files | awk '{print $2}')
if [ -z "$ids" ]; then
  printf 'FAIL: no "## US-XXX" story headings found\n' >&2
  exit 1
fi

dup=$(printf '%s\n' $ids | sort | uniq -d)
if [ -n "$dup" ]; then
  err "duplicate story ids: $(printf '%s' "$dup" | tr '\n' ' ')"
fi

for f in $files; do
  awk '
    function flush() {
      if (cur == "" || ret) return
      if (!stmt) { printf "FAIL: %s has no non-empty Statement line\n", cur; bad=1 }
      if (!shall) { printf "FAIL: %s has no criterion containing SHALL\n", cur; bad=1 }
      if (todo) { printf "FAIL: %s contains TODO/TBD\n", cur; bad=1 }
    }
    /^## US-[0-9][0-9][0-9]( |$)/ { flush(); cur=$2; stmt=0; shall=0; todo=0; ret=0; if ($0 ~ /\(retired\)/) ret=1; next }
    /^## / { flush(); cur=""; next }
    cur != "" {
      if ($0 ~ /^Statement:/) { s=$0; sub(/^Statement:[ \t]*/, "", s); if (length(s) > 0) stmt=1 }
      if ($0 ~ /SHALL/) shall=1
      if ($0 ~ /TODO|TBD/) todo=1
      if ($0 ~ /^Retired:/) ret=1
    }
    END { flush(); exit bad }
  ' "$f" >&2 || fail=1
done

for target in $(grep -hoE 'Superseded by US-[0-9]{3}' $files | awk '{print $3}' | sort -u); do
  printf '%s\n' $ids | grep -qx "$target" || err "supersede target $target does not resolve"
done

missing=$(grep -h '^Evidence:' $files | grep -o '`[^`]*`' | tr -d '`' | sort -u | while IFS= read -r p; do
  case "$p" in
    *" "*) continue ;;
    *"/"*|*.go|*.ts|*.tsx|*.py|*.sh|*.md|*.json|*.sql|*.css|*.html|*.yml|*.yaml)
      [ -e "$p" ] || printf '%s\n' "$p" ;;
  esac
done)
if [ -n "$missing" ]; then
  old_ifs=$IFS
  IFS='
'
  for p in $missing; do
    if [ "$strict_evidence" -eq 1 ]; then err "evidence path missing: $p"
    else warn "evidence path missing: $p"; fi
  done
  IFS=$old_ifs
fi

if [ "$tests" -eq 1 ]; then
  found=$(find . -type f \( -name '*_test.go' -o -name '*.test.ts' -o -name '*.test.tsx' -o -name 'test_*.py' -o -name '*_test.py' \) \
    -not -path './.git/*' -not -path '*/node_modules/*' -not -path './vendor/*' 2>/dev/null | tr '\n' ' ')
  if [ -n "$found" ]; then
    cites=$({ grep -hoE 'US-[0-9]{3}' $found 2>/dev/null || true; } | sort -u)
    for id in $cites; do
      printf '%s\n' $ids | grep -qx "$id" || err "test cites unknown id: $id"
    done
    for id in $ids; do
      printf '%s\n' $cites | grep -qx "$id" || warn "no test cites $id (advisory)"
    done
  else
    warn 'no test files found for --tests scan'
  fi
fi

if [ "$fail" -ne 0 ]; then
  printf 'check-stories: FAILED\n' >&2
  exit 1
fi
printf 'check-stories: PASS\n'
