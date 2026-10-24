#!/bin/bash
# Render an Omarchy shell plugin's popup off-screen and screenshot it.
#
#   headless-preview.sh <panel.qml> <out.png> [settle-seconds]
#
# Runs a headless sway in a private runtime directory, loads the panel through
# quickshell with a stand-in bar, and captures the framebuffer with grim. No
# window reaches the operator's display, and the live shell is untouched.
set -eu

panel=${1:?usage: headless-preview.sh <panel.qml> <out.png> [settle-seconds]}
out=${2:?usage: headless-preview.sh <panel.qml> <out.png> [settle-seconds]}
settle=${3:-5}

panel=$(readlink -f "$panel")
out=$(readlink -f "$(dirname "$out")")/$(basename "$out")

harness=$(mktemp -d "${TMPDIR:-$HOME/.cache/tmp}/omarchy-preview.XXXXXX")
# Keep the session's runtime dir so user units and the bus stay reachable; the
# headless compositor only adds its own Wayland socket beside the live one.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
before=$(ls "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null | grep -v '\.lock$' || true)

cleanup() {
  [ -n "${qs_pid:-}" ] && kill "$qs_pid" 2>/dev/null || true
  [ -n "${sway_pid:-}" ] && kill "$sway_pid" 2>/dev/null || true
  rm -rf -- "$harness"
}
trap cleanup EXIT INT TERM

ln -s /usr/share/omarchy/shell/Commons "$harness/Commons"
ln -s /usr/share/omarchy/shell/Ui "$harness/Ui"

cat > "$harness/sway.conf" <<'EOF'
output HEADLESS-1 resolution 1600x900 bg #16181a solid_color
EOF

cat > "$harness/shell.qml" <<QML
import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons as Commons

ShellRoot {
  id: harness

  property QtObject mockBar: QtObject {
    property string position: "top"
    property int barSize: 26
    property bool vertical: false
    property color barForeground: Commons.Color.foreground
    property var activePopout: null
    function requestPopout(key) { activePopout = key }
    function releasePopout(key) { if (activePopout === key) activePopout = null }
    function moduleWidgets(name) { return [] }
    function run(command) { }
    function switchPanelFrom(panel, direction) { return false }
  }

  PanelWindow {
    anchors { top: true; left: true; right: true }
    implicitHeight: 200
    color: "#16181a"

    Rectangle {
      anchors { top: parent.top; left: parent.left; right: parent.right }
      height: 26
      color: "#0b0d0e"
    }

    Loader {
      anchors { top: parent.top; right: parent.right; rightMargin: 420 }
      source: "file://$panel"

      onLoaded: {
        item.bar = harness.mockBar
        item.moduleName = "preview"
        Qt.callLater(function() { item.open() })
      }
    }
  }
}
QML

WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
  sway -c "$harness/sway.conf" > "$harness/sway.log" 2>&1 &
sway_pid=$!

display=
for _ in $(seq 1 50); do
  after=$(ls "$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null | grep -v '\.lock$' || true)
  display=$(comm -13 <(printf '%s\n' "$before" | sort) <(printf '%s\n' "$after" | sort) | head -1)
  [ -n "$display" ] && break
  sleep 0.1
done
if [ -z "$display" ]; then
  echo "sway did not start; see $harness/sway.log" >&2
  tail -5 "$harness/sway.log" >&2
  exit 1
fi
export WAYLAND_DISPLAY=${display##*/}

quickshell -p "$harness" > "$harness/qs.log" 2>&1 &
qs_pid=$!
sleep "$settle"

if ! grep -q "Configuration Loaded" "$harness/qs.log"; then
  echo "quickshell failed to load the panel:" >&2
  tail -20 "$harness/qs.log" >&2
  exit 1
fi
if grep -q '\[syntax\]' "$harness/qs.log"; then
  echo "QML syntax error:" >&2
  grep '\[syntax\]' "$harness/qs.log" >&2
  exit 1
fi

grim "$out"
printf '%s\n' "$out"

# Keep the harness log available for the caller when they need to debug.
if [ -n "${OMARCHY_PREVIEW_LOG:-}" ]; then
  cp "$harness/qs.log" "$OMARCHY_PREVIEW_LOG"
fi
