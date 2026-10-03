# pi-config

Own Pi settings, extensions and the global intro. Edit source; `./install`
deploys selected components to `$PI_CODING_AGENT_DIR` (default `~/.pi/agent`).
Owned keys/packages overlay foreign settings, sessions and credentials.

Shared primitives come from sibling `../agent-config` (`AGENT_CONFIG_DIR`
overrides it). `README.md` owns the component/divergence ledger and foreign
paths; `docs/adr/` records architectural decisions.

Run `../scripts/check pi`, including both committed-HEAD installer compositions.
Observe a fresh Pi session to prove extension loading. Keep extensions focused
and removable, composer identity on the top rail, and footer content below.
Root automation owns hooks, secret scanning and releases.
