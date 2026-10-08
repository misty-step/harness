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

OMP cages intentionally hide the host keyring. For GitHub, use this pass-backed
route for `gh` and Git's configured `gh` credential helper:

```sh
pass-env run -e GH_TOKEN=workstation/GITHUB_TOKEN_MOOMOOSKYCOW -- gh auth status
pass-env run -e GH_TOKEN=workstation/GITHUB_TOKEN_MOOMOOSKYCOW -- git push -u origin HEAD
pass-env run -e GH_TOKEN=workstation/GITHUB_TOKEN_MOOMOOSKYCOW -- gh pr create --fill
```

Mappings are literal `NAME=pass/entry`, not values or shell expressions.
Bind only what the command needs. Verify the intended issuer operation, not just
injection. `pass-env` is not a sandbox.

Avoid plaintext output. Printing a token alone is not an incident: do not rotate,
revoke or report it for that. Rotation needs authority and updates every consumer.
[pass-contract.md](pass-contract.md) covers byte/precedence traps;
[maintenance.md](maintenance.md) covers private insertion.
