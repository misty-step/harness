# Agent audio sandbox (US-026)

Agent sessions play into the silent PipeWire sink `agent-sandbox`, never the
operator's speakers. `env.ts` is the contract: `PULSE_SINK`/`PULSE_SOURCE` for
PulseAudio clients, `PIPEWIRE_NODE` for native PipeWire/ALSA clients, and
`node.dont-fallback`, so a stream aimed at a missing sink stays unlinked.
`AGENT_AUDIO_SANDBOX` lists the routing keys.

| Harness | Startup layer | Extension layer |
| --- | --- | --- |
| OMP | owned block in the agent `.env` | `extensions/audio-sandbox`: `process.env`, plus a leading line in each Python eval cell |
| Pi | `shellCommandPrefix` in `settings.json` | `extensions/audio-sandbox`: `process.env` |
| Claude Code | `env` in `~/.claude/settings.json` | none |

The startup layer keeps bash routed if an extension fails to load. OMP's Python
runner gets an allowlisted environment, so the extension rewrites each cell
(after `from __future__` imports; `%%bash` gets exports; standalone
`%load local://…` loads its backing file and fails closed without a session root);
tracebacks count one extra line. Processes, browsers and broker daemons started
before a deploy keep the old environment until they exit.

`install --audio-sandbox` writes
`~/.config/pipewire/pipewire.conf.d/60-agent-sandbox.conf` at lowest priority,
merges the contract into Claude Code's `env`, and, when PipeWire is reachable,
creates the sink live without a restart and proves routing with silent `pw-play`
and `paplay` streams. An unowned drop-in or malformed Claude Code settings fail
before any write.

Agents record with default `pw-record out.wav` or `parecord out.wav`. The operator
listens from their own terminal: `mpv render.mp4`, `pw-play render.wav`, or live
`pw-loopback --capture-props='target.object=agent-sandbox stream.capture.sink=true'`.
Requested speech (`sachstand`) deliberately drops the keys.

Not stopped: `env -i`, `systemd-run`, D-Bus activation, `hyprctl dispatch exec`,
raw idle ALSA `hw:` devices, and IPC into running operator apps.

Revert: remove the drop-in, `pw-cli destroy agent-sandbox`, delete the owned block
from `~/.omp/agent/.env`, `shellCommandPrefix` from `~/.pi/agent/settings.json`
and the listed keys from `~/.claude/settings.json`, and remove both
`extensions/audio-sandbox` directories.
