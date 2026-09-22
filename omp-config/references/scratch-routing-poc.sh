#!/usr/bin/env bash
# Proof of concept for references/scratch-routing.md (A3: route agent scratch off
# the RAM tmpfs). Tiny and local: every byte stays under
# ${XDG_CACHE_HOME:-$HOME/.cache}/tmp/runs, and /tmp is never written.
#
#   ./scratch-routing-poc.sh          run the lifecycle demonstration
#   ./scratch-routing-poc.sh owner L  internal: own a run dir, trap cleanup, run cmd
#   ./scratch-routing-poc.sh gc       internal: liveness-keyed stale sweep
set -u

CACHE_TMP=${SCRATCH_CACHE_TMP:-${XDG_CACHE_HOME:-$HOME/.cache}/tmp}
RUNS=$CACHE_TMP/runs
GRACE=${SCRATCH_GC_GRACE:-900}
EVID=$CACHE_TMP/.poc-evidence
TMP_BEFORE=$(ls -1 /tmp | wc -l)

mkdir -p "$RUNS" "$EVID"
chmod 700 "$RUNS" "$EVID"

# --- liveness: the owner holds an exclusive flock for its whole lifetime. The
# kernel drops it when the last process holding the fd dies, including SIGKILL,
# so this needs no PID bookkeeping and has no PID-reuse hazard.
is_live() {
  local d=$1 lock=$1/.owner.lock
  [ -e "$lock" ] || return 1
  exec 8>>"$lock"
  if flock -n 8; then exec 8>&-; return 1; fi
  exec 8>&-; return 0
}

sweep() { # liveness-keyed stale sweep; age is a second safety net
  local grace=$GRACE d age reaped=0 kept=0
  if [ "${1:-}" = --grace ]; then grace=$2; fi
  for d in "$RUNS"/*/; do
    [ -d "$d" ] || continue
    d=${d%/}; age=$(( $(date +%s) - $(stat -c %Y "$d") ))
    if is_live "$d"; then kept=$((kept+1)); echo "gc: keep  (live)            $(basename "$d")"; continue; fi
    if [ "$age" -lt "$grace" ]; then kept=$((kept+1)); echo "gc: keep  (age ${age}s<${grace}s) $(basename "$d")"; continue; fi
    case "$d" in "$RUNS"/*) rm -rf -- "$d" && { reaped=$((reaped+1)); echo "gc: reap  (age ${age}s, unlocked) $(basename "$d")"; };; esac
  done
  echo "gc: reaped=$reaped kept=$kept"
}

owner() { # owner <label> -- <cmd...>: create the run-scoped TMPDIR, hold it, trap cleanup
  local label=$1 run; shift; [ "${1:-}" = -- ] && shift
  run="$RUNS/$(date -u +%Y%m%dT%H%M%SZ)-$$-$label"
  mkdir -p "$run" && chmod 700 "$run" || exit 4
  printf '{"run":"%s","owner_pid":%s,"started":"%s"}\n' \
    "$(basename "$run")" "$$" "$(date -u +%FT%TZ)" >"$run/owner.json"
  exec 9>>"$run/.owner.lock" || exit 4
  flock -n 9 || { echo "owner: lock busy" >&2; exit 3; }
  export TMPDIR=$run TMP=$run TEMP=$run
  export OMP_SCRATCH_RUN=$(basename "$run")
  cleanup() {
    [ -n "${run:-}" ] || return 0
    case "$run" in "$RUNS"/*) ;; *) echo "refuse to remove $run" >&2; return 1;; esac
    rm -rf -- "$run"
  }
  trap cleanup EXIT INT TERM HUP
  echo "RUN=$run"
  "$@" 9>&- &                     # children must not inherit the lock fd
  local child=$!; echo "CHILD=$child"
  wait "$child"; local rc=$?
  echo "CHILD_RC=$rc"
  exit "$rc"
}

if [ "${1:-poc}" = owner ]; then shift; owner "$@"; fi
if [ "${1:-poc}" = gc ]; then shift; sweep "$@"; exit 0; fi

# ---------------------------------------------------------------------------
# Demonstration
# ---------------------------------------------------------------------------
fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "ok:   $*"; }
step() { echo; echo "== $* =="; }

mkdir_result() {  # a mkdtemp(os.tmpdir()) caller in two runtimes
  node -e 'const fs=require("fs"),os=require("os"),p=require("path");
    console.log("NODE_MKDTEMP="+fs.mkdtempSync(p.join(os.tmpdir(),"poc-node-")));'
  python3 -c 'import tempfile;print("PY_MKDTEMP="+tempfile.mkdtemp(prefix="poc-py-"))'
}

step "act 1 — run-scoped TMPDIR is honoured by mkdtemp(os.tmpdir()), and the run dir is removed on exit"
bash "$0" owner ok -- bash -c "$(declare -f mkdir_result); mkdir_result" >"$EVID/act1.log" 2>&1
run=$(sed -n 's/^RUN=//p' "$EVID/act1.log")
node_path=$(sed -n 's/^NODE_MKDTEMP=//p' "$EVID/act1.log")
py_path=$(sed -n 's/^PY_MKDTEMP=//p' "$EVID/act1.log")
[ -n "$run" ] && [ -n "$node_path" ] && [ -n "$py_path" ] || { cat "$EVID/act1.log"; fail "act 1 produced no paths"; }
case "$node_path" in "$run"/*) ok "node mkdtemp inside run dir: $node_path";; *) fail "node mkdtemp outside run dir: $node_path";; esac
case "$py_path"   in "$run"/*) ok "python mkdtemp inside run dir: $py_path";; *) fail "python outside run dir: $py_path";; esac
[ ! -e "$run" ] || fail "run dir survived its owner: $run"
[ ! -e "$node_path" ] || fail "mkdtemp child survived with the run"
ok "run dir removed by the owner trap on normal exit ($run)"

step "act 2 — worker SIGKILL: the owner's trap still removes the run dir"
bash "$0" owner killed-worker -- bash -c \
  "$(declare -f mkdir_result); mkdir_result; echo WORKER=\$\$; exec sleep 300" >"$EVID/act2.log" 2>&1 &
owner2=$!
for _ in $(seq 1 100); do grep -q WORKER= "$EVID/act2.log" 2>/dev/null && break; sleep 0.05; done
run2=$(sed -n 's/^RUN=//p' "$EVID/act2.log"); worker2=$(sed -n 's/^WORKER=//p' "$EVID/act2.log")
[ -n "$run2" ] && [ -n "$worker2" ] || { cat "$EVID/act2.log"; fail "act 2 did not start"; }
[ -d "$run2" ] || fail "act 2 run dir missing before kill"
kill -9 "$worker2"
wait "$owner2"; rc2=$?
ok "worker $worker2 SIGKILLed; owner exit status $rc2 (137=SIGKILL propagated)"
[ ! -e "$run2" ] || fail "run dir survived a SIGKILLed worker: $run2"
ok "run dir removed by the owner trap after the worker was SIGKILLed ($run2)"

step "act 3 — owner SIGKILL: no trap can run, so the liveness-keyed sweep reclaims it"
bash "$0" owner dead-owner -- bash -c 'echo OWNERCHILD=$$; exec sleep 300' >"$EVID/act3.log" 2>&1 &
owner3=$!
for _ in $(seq 1 100); do grep -q OWNERCHILD= "$EVID/act3.log" 2>/dev/null && break; sleep 0.05; done
run3=$(sed -n 's/^RUN=//p' "$EVID/act3.log"); kid3=$(sed -n 's/^OWNERCHILD=//p' "$EVID/act3.log")
kill -9 "$owner3"; wait "$owner3" 2>/dev/null
[ -d "$run3" ] || fail "act 3 run dir vanished without a sweep (unexpected)"
ok "owner $owner3 SIGKILLed; trap could not run, run dir remains: $run3"
echo "--- sweep with grace 0 ---"
sweep --grace 0 | sed 's/^/    /'
[ ! -e "$run3" ] || fail "sweep did not reclaim an unlocked stale run: $run3"
ok "sweep reclaimed the run dir after the owner was SIGKILLed"
kill -9 "$kid3" 2>/dev/null

step "act 4 — a live run is never reaped, even with grace 0"
bash "$0" owner live -- bash -c 'echo LIVECHILD=$$; exec sleep 300' >"$EVID/act4.log" 2>&1 &
owner4=$!
for _ in $(seq 1 100); do grep -q LIVECHILD= "$EVID/act4.log" 2>/dev/null && break; sleep 0.05; done
run4=$(sed -n 's/^RUN=//p' "$EVID/act4.log"); kid4=$(sed -n 's/^LIVECHILD=//p' "$EVID/act4.log")
[ -d "$run4" ] || fail "act 4 run dir missing"
sweep --grace 0 | sed 's/^/    /'
[ -d "$run4" ] || fail "sweep reaped a LIVE run: $run4"
ok "live run protected by its lock, not by age: $run4"
kill -9 "$owner4"; kill -9 "$kid4" 2>/dev/null; wait "$owner4" 2>/dev/null

step "act 5 — /tmp was not written"
sweep --grace 0 >/dev/null
TMP_AFTER=$(ls -1 /tmp | wc -l)
[ "$TMP_AFTER" = "$TMP_BEFORE" ] || fail "/tmp entry count changed: $TMP_BEFORE -> $TMP_AFTER"
ok "/tmp entry count unchanged ($TMP_BEFORE)"
ls -1 /tmp | grep -c '^poc-' | grep -qx 0 || fail "poc entries in /tmp"
ok "no poc-* entries in /tmp"
rm -rf "$EVID"
rmdir "$RUNS" 2>/dev/null
ok "evidence removed; runs/ left empty"

echo
echo "ALL ACTS PASSED"