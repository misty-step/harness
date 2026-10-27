#!/usr/bin/env bash
# Install Kaylee's scheduled jobs (idempotent: an existing job with the same name
# is left alone; edit it with `hermes -p default cron edit`).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HERMES_HOME=${HERMES_HOME:-$HOME/.hermes}
HERMES=${HERMES:-$HOME/.local/bin/hermes}
workspace=${KAYLEE_WORKSPACE:-$HOME/workspace/factory}
deliver=${KAYLEE_DELIVER:?set KAYLEE_DELIVER to discord:<owner DM channel id>}

mkdir -p "$HERMES_HOME/scripts"
install -m 0755 "$here/scripts/kaylee-runs-state.sh" "$HERMES_HOME/scripts/kaylee-runs-state.sh"

have_job() { "$HERMES" -p default cron list --all 2>/dev/null | grep -F -- "$1" >/dev/null; }
# `cron create` can report a refusal and still exit 0, so confirm by listing.
created() { have_job "$1" || { echo "install-cron: failed to create $1" >&2; exit 1; }; echo "install-cron: created $1"; }

if ! have_job kaylee-workers; then
  "$HERMES" -p default cron create 'every 10m' \
    "One or more of your Boat worker runs changed state; the monitor diff shows which. For each changed run: if it finished, read \`kaylee-dispatch result\`, check the claimed PR, checks and evidence yourself, then \`kaylee-dispatch finish\` it and record the outcome in Daybook. Launch the next step the work needs (independent QA, review, judgment, merge after SHIP plus green checks, or a fix round), each on its own Boat VM. If a run failed or looks stuck, diagnose it from its logs and act. Tell Phaedrus only what he needs to know or decide. If nothing needs him, reply exactly [SILENT]." \
    --name kaylee-workers \
    --monitor-script kaylee-runs-state.sh \
    --skill boat-dispatch --skill daybook \
    --workdir "$workspace" \
    --deliver "$deliver"
  created kaylee-workers
fi

if ! have_job kaylee-legacy-fleet; then
  "$HERMES" -p default cron create 'every 2h' \
    "Retire the legacy fleet on this host. Phaedrus decided on 2026-10-27 that Grok Bot no longer does engineering: its in-flight sessions finish, then its access is cut, and you adopt what they leave unfinished. Run \`tern ls --json\` and consider every session except the one named Factory. Capture each with \`tern capture\`. Leave any session whose agent is still working. For a session that finished or sits idle at its prompt, record its outcome (PR links shipped, and any unfinished work as a GitHub issue on the right repository or a Daybook note), then \`tern close\` it. Never type into a session. When no session but Factory remains, run \`kaylee-retire-legacy-access\`, tell Phaedrus what you adopted and what you cut, write the outcome to Daybook, and remove this job with \`hermes -p default cron remove <its id from hermes -p default cron list>\`. Otherwise, if nothing needs Phaedrus, reply exactly [SILENT]." \
    --name kaylee-legacy-fleet \
    --skill daybook \
    --workdir "$workspace" \
    --deliver "$deliver"
  created kaylee-legacy-fleet
fi
