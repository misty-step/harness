---
name: authenticated-commands
description: Discover credentials and run authenticated commands through native logins, pass entries, or project .env.pass references.
---

# Authenticated commands

Keep working native logins. Before declaring credentials missing, check native
auth, `pass-env list TERM`, project `.env.pass`/ignored env, then existing consumers
such as `~/.hermes/profiles/*/.env`. An unreadable remote secret is not a lost key.

```sh
pass-env run -e NAME=workstation/ENTRY -- command
pass-env run -f .env.pass -- command
```

Mappings are literal `NAME=pass/entry`, not values or shell expressions.
Bind only what the command needs. Verify the intended issuer operation, not just
injection. `pass-env` is not a sandbox.

Avoid plaintext output. Printing a token alone is not an incident: do not rotate,
revoke or report it for that. Rotation needs authority and updates every consumer.
[pass-contract.md](pass-contract.md) covers byte/precedence traps;
[maintenance.md](maintenance.md) covers private insertion.
