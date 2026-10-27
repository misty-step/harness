#!/usr/bin/env bash
# Install Kaylee, the Hermes chief engineering officer, on the chief's exe.dev
# host from this checkout. Idempotent. Run as the Hermes user:
#
#   ~/workspace/kaylee-src/agent-config/chief/install-kaylee.sh
#
# It owns: SOUL.md, the chief workspace AGENTS.md link, Kaylee's skills and
# config cutover, the parked legacy role profiles, the Daybook refresh timer, the
# Boat worker tooling (worker/boat/install-factory.sh) and Kaylee's cron jobs.
# It does not restart the gateway: run
#   sudo systemctl restart hermes-gateway.service
# when no Kaylee turn is in flight, then start a new session to load SOUL.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HERMES_HOME=${HERMES_HOME:-$HOME/.hermes}
HERMES=${HERMES:-$HOME/.local/bin/hermes}
workspace=${KAYLEE_WORKSPACE:-$HOME/workspace/factory}
legacy_profiles=(builder judge qa release researcher reviewer)
export PATH="$HOME/.local/bin:$PATH"

hset() { "$HERMES" -p default config set "$1" "$2" >/dev/null; }
say() { printf 'install-kaylee: %s\n' "$*"; }

[[ -x $HERMES ]] || { echo "install-kaylee: hermes not found at $HERMES" >&2; exit 1; }
command -v exocortex >/dev/null || { echo "install-kaylee: exocortex missing; install Daybook access first" >&2; exit 1; }

# Identity and operating manual.
install -m 0644 "$here/SOUL.md" "$HERMES_HOME/SOUL.md"
mkdir -p "$workspace"
ln -sfn "$here/AGENTS.md" "$workspace/AGENTS.md"
say "SOUL.md installed; $workspace/AGENTS.md -> $here/AGENTS.md"

# Worker tooling: Boat CLI key check, kaylee-dispatch, tunnel unit, boat-dispatch skill.
"$here/worker/boat/install-factory.sh"

# Kaylee's own skills.
for skill in "$here"/skills/*/; do
  name=$(basename "$skill")
  rm -rf "$HERMES_HOME/skills/$name.new"
  cp -R "$skill" "$HERMES_HOME/skills/$name.new"
  rm -rf "$HERMES_HOME/skills/$name"
  mv "$HERMES_HOME/skills/$name.new" "$HERMES_HOME/skills/$name"
done
install -m 0755 "$here/bin/kaylee-retire-legacy-access" "$HOME/.local/bin/kaylee-retire-legacy-access"
say "skills installed: $(cd "$here/skills" && echo *)"

# One durable identity: no personality overlay or coding posture.
hset display.personality ''
hset agent.system_prompt ''
hset agent.coding_context off

# Daybook is the only memory; Hermes private memory is off.
hset memory.memory_enabled false
hset memory.user_profile_enabled false
hset memory.nudge_interval 0
hset memory.provider ''
hset memory.prefetch_spill_enabled false

# Skills: always load the control-plane procedures; hide the implement-it-yourself ones.
hset skills.auto_load '["boat-dispatch","daybook"]'
hset skills.creation_nudge_interval 0
hset skills.disabled '["codebase-inspection","dogfood","github","hermes-agent-skill-authoring","inspecting-hermes-desktop-dom","node-inspect-debugger","python-debugpy","requesting-code-review","simplify-code","spike","systematic-debugging","test-driven-development"]'

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

# Tool scope: no file editing, code execution, delegation, browser or desktop.
hset agent.disabled_toolsets '["delegation","code_execution","file","computer_use","browser","discord_admin","kanban","memory"]'
hset platform_toolsets.cli '["terminal","skills","session_search","todo","web","clarify","cronjob"]'
hset platform_toolsets.discord '["terminal","skills","session_search","todo","web","clarify","cronjob","discord"]'
hset platform_toolsets.cron '["terminal","skills","session_search","todo","web"]'

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
# Daybook writes through `exocortex put --from -`.
hset command_allowlist '["kaylee-dispatch *","exocortex *","kaylee-retire-legacy-access","script execution via heredoc"]'
say "config cutover applied"

# Daybook read freshness (system unit; the user bus is not reliable here).
for unit in daybook-refresh.service daybook-refresh.timer; do
  sed -e "s|@HOME@|$HOME|g" -e "s|@USER@|$(id -un)|g" "$here/systemd/$unit" \
    | sudo tee "/etc/systemd/system/$unit" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now daybook-refresh.timer >/dev/null
say "daybook-refresh.timer enabled"

# Cron: wake Kaylee only when a worker run changes state; legacy-fleet cleanup.
# KAYLEE_DELIVER=discord:<owner DM channel id> (kept out of this public repo).
"$here/install-cron.sh"
say "done; restart hermes-gateway.service at an idle moment"
