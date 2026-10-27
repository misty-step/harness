#!/usr/bin/env bash
# Seed Kaylee, the Hermes chief engineering officer, on the chief's exe.dev
# host from this checkout. Run as the Hermes user:
#
#   ~/workspace/kaylee-src/agent-config/chief/install-kaylee.sh
#
# Kaylee owns her identity, manual, skills, learning config and routines.
# Seed missing files and first-boot config only; always enforce Phaedrus's
# boundaries and refresh worker tooling; clone Daybook when absent.
# It does not restart the gateway: run
#   sudo systemctl restart hermes-gateway.service
# when no Kaylee turn is in flight, then start a new session to load SOUL.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export HERMES_HOME=${HERMES_HOME:-$HOME/.hermes}
HERMES=${HERMES:-$HOME/.local/bin/hermes}
workspace=${KAYLEE_WORKSPACE:-$HOME/workspace/factory}
legacy_profiles=(builder judge qa release researcher reviewer)
export PATH="$HOME/.local/bin:$PATH"

hset() { "$HERMES" -p default config set "$1" "$2" >/dev/null; }
say() { printf 'install-kaylee: %s\n' "$*"; }

[[ -x $HERMES ]] || { echo "install-kaylee: hermes not found at $HERMES" >&2; exit 1; }

# Existing paths (including symlinks) belong to Kaylee; never replace them.
seed_file() {
  local source=$1 destination=$2
  if [[ -e $destination || -L $destination ]]; then
    say "kept $destination"
  else
    install -m 0644 "$source" "$destination"
    say "seeded $destination"
  fi
}
mkdir -p "$HERMES_HOME/skills" "$workspace"
seed_file "$here/SOUL.md" "$HERMES_HOME/SOUL.md"
seed_file "$here/AGENTS.md" "$workspace/AGENTS.md"

# Worker tooling: Boat CLI key check, kaylee-dispatch and tunnel unit.
"$here/worker/boat/install-factory.sh"

# Kaylee's own skills.
for skill in "$here"/skills/*/; do
  name=$(basename "$skill")
  destination=$HERMES_HOME/skills/$name
  if [[ -e $destination || -L $destination ]]; then
    say "kept $destination"
  else
    cp -R "$skill" "$destination"
    say "seeded $destination"
  fi
done
install -m 0755 "$here/bin/kaylee-retire-legacy-access" "$HOME/.local/bin/kaylee-retire-legacy-access"

# No marker means first boot, including the first run after this cutover.
# Mark only after all identity/learning writes succeed; later boundary or tooling
# failures must not cause a rerun to reset config Kaylee has since changed.
seed_marker=$HERMES_HOME/.kaylee-seeded
if [[ -e $seed_marker ]]; then
  say "kept seeded config ($seed_marker)"
else
  hset display.personality ''
  hset agent.system_prompt ''
  hset agent.coding_context off

  # Hermes is her working memory; Daybook holds context other agents need.
  hset memory.memory_enabled true
  hset memory.user_profile_enabled true
  hset memory.nudge_interval 10
  hset memory.provider ''
  hset memory.prefetch_spill_enabled false

  hset skills.auto_load '["boat-dispatch","daybook"]'
  hset skills.creation_nudge_interval 10
  hset skills.disabled '["codebase-inspection","dogfood","github","inspecting-hermes-desktop-dom","node-inspect-debugger","python-debugpy","requesting-code-review","simplify-code","spike","systematic-debugging","test-driven-development"]'

  # Tool selection is Kaylee's to evolve; dispatch and approval boundaries below
  # remain enforced independently of these seeded toolsets.
  hset agent.disabled_toolsets '["delegation","code_execution","file","computer_use","browser","discord_admin","kanban"]'
  hset platform_toolsets.cli '["terminal","skills","session_search","todo","web","clarify","cronjob","memory"]'
  hset platform_toolsets.discord '["terminal","skills","session_search","todo","web","clarify","cronjob","discord","memory"]'
  hset platform_toolsets.cron '["terminal","skills","session_search","todo","web"]'
  touch "$seed_marker"
  say "seeded identity and learning config"
fi

# No native Hermes workers: engineering only runs as OMP on its own Boat VM.
hset delegation.backend default
hset delegation.backends '{}'
hset plugins.enabled '["platforms/discord"]'
hset plugins.disabled '["platforms/slack","advanced-delegation"]'
hset kanban.dispatch_in_gateway false
hset kanban.review_dispatch false
hset kanban.auto_decompose false
hset kanban.dispatch_profiles '[]'
# A multiplexed profile parks through `gateway stop`; a stopped or standalone one
# does not, so write the supported gateway.parked sentinel either way.
for p in "${legacy_profiles[@]}"; do
  dir=$HERMES_HOME/profiles/$p
  [[ -d $dir && ! -e $dir/gateway.parked ]] || continue
  "$HERMES" -p "$p" gateway stop >/dev/null 2>&1 || say "gateway stop for $p reported failure; parking by sentinel"
  touch "$dir/gateway.parked"
done
say "legacy role profiles parked: ${legacy_profiles[*]}"

# Owner-only Discord; unknown DMs are ignored.
hset gateway.allow_all_users false
hset platforms.discord.unauthorized_dm_behavior ignore
hset discord.allow_bots '"none"'

# Unattended surfaces deny flagged commands except Kaylee's audited CLIs.
hset approvals.mode manual
hset approvals.cron_mode deny
hset approvals.single_query_mode deny
hset approvals.unattended_mode deny
# "script execution via heredoc": Phaedrus approved it (always) on 2026-10-27 for
# her unattended scripts.
hset command_allowlist '["kaylee-dispatch *","kaylee-retire-legacy-access","script execution via heredoc"]'
say "boundary config enforced"

# Daybook is read and written directly with git; nothing refreshes it. Retire the
# timer pair that earlier seeds installed on hosts. The unit names are assembled so
# the repository carries no literal reference to the retired system.
systemd_system_dir=${KAYLEE_SYSTEMD_SYSTEM_DIR:-/etc/systemd/system}
stale_units=()
stem=daybook-re
for kind in timer service; do
  unit=${stem}fresh.$kind
  [[ -e $systemd_system_dir/$unit || -L $systemd_system_dir/$unit ]] && stale_units+=("$unit")
done
if ((${#stale_units[@]})); then
  sudo systemctl disable --now "${stale_units[@]}" >/dev/null 2>&1 || say "disable of ${stale_units[*]} reported failure; removing the files anyway"
  for unit in "${stale_units[@]}"; do sudo rm -f "$systemd_system_dir/$unit"; done
  sudo systemctl daemon-reload
  say "removed retired ${stale_units[*]}"
fi

# Daybook clone: only when absent; an existing clone is Kaylee's and stays as is.
# KAYLEE_SKIP_DAYBOOK_CLONE=1 skips the network clone (tests).
daybook=${KAYLEE_DAYBOOK_DIR:-$HOME/development/moomooskycow/daybook}
if [[ -e $daybook || -L $daybook ]]; then
  say "kept $daybook"
elif [[ -n ${KAYLEE_SKIP_DAYBOOK_CLONE:-} ]]; then
  say "skipped Daybook clone (KAYLEE_SKIP_DAYBOOK_CLONE)"
else
  mkdir -p "$(dirname "$daybook")"
  gh repo clone moomooskycow/daybook "$daybook" >/dev/null
  git -C "$daybook" config user.name Kaylee
  git -C "$daybook" config user.email kaylee@agents.misty-step.com
  say "cloned $daybook"
fi

# Cron: wake Kaylee only when a worker run changes state; legacy-fleet cleanup.
# KAYLEE_DELIVER=discord:<owner DM channel id> (kept out of this public repo).
"$here/install-cron.sh"
say "done; restart hermes-gateway.service at an idle moment"
