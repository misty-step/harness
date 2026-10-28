#!/usr/bin/env bash
# Seed Kaylee, the Hermes chief engineering officer, on the chief's exe.dev
# host from this checkout. Run as the Hermes user:
#
#   ~/workspace/kaylee-src/agent-config/chief/install-kaylee.sh
#
# Kaylee owns her identity, manual, skills, learning config and routines.
# Seed missing files and first-boot config only; always enforce Phaedrus's
# boundaries and refresh worker tooling and the Daybook timer.
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
# First-boot list defaults add missing entries; existing choices are not reset.
hseed_list() {
  local merged
  merged=$(python3 - "$HERMES" "$1" "$2" <<'PY'
import json
import subprocess
import sys

hermes, key, defaults = sys.argv[1:]
result = subprocess.run([hermes, "-p", "default", "config", "get", key, "--json"],
                        capture_output=True, text=True)
if result.returncode == 1 and result.stderr.strip() == f"Config key not set: {key}":
    current = []  # A fresh Hermes home need not have per-platform lists yet.
else:
    if result.returncode:
        sys.stderr.write(result.stderr)
        result.check_returncode()
    current = json.loads(result.stdout)
print(json.dumps(current + [item for item in json.loads(defaults) if item not in current]))
PY
)
  hset "$1" "$merged"
}
say() { printf 'install-kaylee: %s\n' "$*"; }

[[ -x $HERMES ]] || { echo "install-kaylee: hermes not found at $HERMES" >&2; exit 1; }
command -v exocortex >/dev/null || { echo "install-kaylee: exocortex missing; install Daybook access first" >&2; exit 1; }

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
# Compare against a pristine home made by this Hermes, not a prefix or a copied
# template: even a one-byte customization is owned. Never follow SOUL symlinks.
if [[ -f $HERMES_HOME/SOUL.md && ! -L $HERMES_HOME/SOUL.md ]]; then
  default_home=$(mktemp -d)
  trap 'rm -rf -- "$default_home"' EXIT
  HERMES_HOME="$default_home" "$HERMES" -p default config set display.personality '' >/dev/null
  if cmp -s "$default_home/SOUL.md" "$HERMES_HOME/SOUL.md"; then
    install -m 0644 "$here/SOUL.md" "$HERMES_HOME/SOUL.md"
    say "seeded $HERMES_HOME/SOUL.md (replaced Hermes default)"
  else
    say "kept $HERMES_HOME/SOUL.md"
  fi
  rm -rf -- "$default_home"
  trap - EXIT
else
  seed_file "$here/SOUL.md" "$HERMES_HOME/SOUL.md"
fi
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

  # Tool selection is Kaylee's to evolve, except native delegation, which the
  # boundary merge below removes on every run.
  hseed_list agent.disabled_toolsets '["delegation","code_execution","file","computer_use","browser","discord_admin","kanban"]'
  hseed_list platform_toolsets.cli '["terminal","skills","session_search","todo","web","clarify","cronjob","memory"]'
  hseed_list platform_toolsets.discord '["terminal","skills","session_search","todo","web","clarify","cronjob","discord","memory"]'
  hseed_list platform_toolsets.cron '["terminal","skills","session_search","todo","web"]'
  touch "$seed_marker"
  say "seeded identity and learning config"
fi

# No native Hermes workers: engineering only runs as OMP on its own Boat VM.
python3 - "$HERMES" <<'PY'
import json
import subprocess
import sys

hermes = [sys.argv[1], "-p", "default", "config"]

def get(key):
    return json.loads(subprocess.check_output([*hermes, "get", key, "--json"], text=True))

def set_list(key, value):
    subprocess.run([*hermes, "set", key, json.dumps(value)], check=True, stdout=subprocess.DEVNULL)

disabled = get("agent.disabled_toolsets")
if "delegation" not in disabled:
    set_list("agent.disabled_toolsets", [*disabled, "delegation"])
for platform, toolsets in get("platform_toolsets").items():
    if isinstance(toolsets, list) and "delegation" in toolsets:
        set_list(f"platform_toolsets.{platform}", [toolset for toolset in toolsets if toolset != "delegation"])
PY
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
# Daybook writes through `exocortex put --from -`.
hset command_allowlist '["kaylee-dispatch *","exocortex *","kaylee-retire-legacy-access","script execution via heredoc"]'
say "boundary config enforced"

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
