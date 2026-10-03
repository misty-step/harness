# Sourced by the hooks. Advisory checks never block, but a check that could not
# run is a failed run, never silence: it reports through Kaylee's outcome route
# (docs/adr/009-nothing-fails-silently.md). A missing recorder is printed.
# The hooks run in the repository root so `outcome` resolves its Git origin,
# never the launcher's directory or a host-owner fallback.
record() {
  if command -v outcome >/dev/null 2>&1; then
    outcome record "$@" || printf 'outcome: could not record %s; this run is unreported\n' "$1" >&2
  else
    printf 'outcome recorder missing (hermes-config host_alerts.py install): %s run unreported\n' "$1" >&2
  fi
}

# advise NAME COMMAND... — run an advisory check with the repository's keys.
# Exit 0/1 are its verdicts; an unreadable key or any other exit is a failed run.
advise() {
  name=$1
  shift
  if ! key_error=$(pass-env run -f .env.pass -- true 2>&1 </dev/null); then
    record "$name" --fail key-unreadable --detail "$key_error"
    return 0
  fi
  status=0
  pass-env run -f .env.pass -- "$@" || status=$?
  case $status in
    0 | 1) record "$name" --ok ;;
    *) record "$name" --fail "exit-$status" --detail "$name exited $status; no advice was produced" ;;
  esac
}
