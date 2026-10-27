#!/usr/bin/env bash
# Run on factory from a source copy containing chief/worker and chief/skills.
set +x
set -euo pipefail
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
chief_dir=$(cd -- "$source_dir/../.." && pwd -P)
install -d -m 0755 "$HOME/.local/bin" "$HOME/.config/systemd/user"
if [[ ! -x "$HOME/.local/bin/boat" ]]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) printf 'Unsupported factory architecture\n' >&2; exit 1 ;; esac
  download=$(mktemp)
  trap 'rm -f -- "$download"' EXIT
  curl -fsSL "https://boat.dev/api/boat/cli/download?platform=linux-$arch&channel=prod" -o "$download"
  install -m 0755 "$download" "$HOME/.local/bin/boat"
fi
install -m 0755 "$chief_dir/skills/boat-dispatch/kaylee-dispatch" "$HOME/.local/bin/kaylee-dispatch"
install -m 0644 "$source_dir/boat-tunnel@.service" "$HOME/.config/systemd/user/boat-tunnel@.service"
# A scoped key is provisioned once over stdin from the Mac, never from a template.
if [[ -s "$HOME/.config/kaylee/boat-api-key" ]]; then
  chmod 0600 "$HOME/.config/kaylee/boat-api-key"
  boat login --key-stdin --json --no-update < "$HOME/.config/kaylee/boat-api-key" >/dev/null
  chmod 0600 "$HOME/.config/ascii/boat/config.json"
else
  printf 'Provision the kaylee-factory scoped Boat key before dispatching\n' >&2
  exit 1
fi
systemctl --user daemon-reload
printf 'Installed CLI: %s/.local/bin/kaylee-dispatch\n' "$HOME"
printf 'Installed unit: %s/.config/systemd/user/boat-tunnel@.service\n' "$HOME"
printf 'Snapshot builder: %s/build-snapshot.sh\n' "$source_dir"
boat --version
boat list --json --no-update
