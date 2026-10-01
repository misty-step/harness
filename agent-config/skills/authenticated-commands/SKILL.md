---
name: authenticated-commands
description: Discover credentials and run authenticated commands through native logins, pass entries, or project .env.pass references.
---

# Authenticated commands

Keep working native authentication. Bind environment credentials through
`pass-env`; the model needs entry names, not plaintext values.

## Discover before declaring a credential missing

Check these sources in order and report the names/locations checked:

1. Native tool auth: `gh`, `wrangler`, `linear`, `ssh exe.dev`, and similar CLIs.
2. Pass: `pass-env list [prefix]` or `--json` lists names without decrypting.
   `~/.config/pass-env/workstation.env.pass` is the names-only static inventory,
   not a live index.
3. Project references and consumers: `.env.pass`, gitignored `.env`, `.env.local`,
   `.env.production*`, and `.dev.vars`.
4. Existing consumers: `~/.hermes/profiles/*/.env`, `~/.config/<app>/config`, or
   another repository's environment for the same service.

Worker/platform secrets cannot be read back after setting. An unreadable remote
value is not evidence that it is lost. Exhaust local sources before considering
rotation; an authorized rotation updates the pass entry and every consumer in
the same change.

Values found only in project/consumer files are migration gaps. Transfer them
privately over stdin into pass, add the inventory name, and commit the project's
names-only `.env.pass`. A repository needing credentials for setup, checks,
walks, or release keeps exactly those references there (ADR-004).

## Run narrowly

```sh
pass-env run -e API_TOKEN=workstation/API_TOKEN -- ./scripts/sync
pass-env run -f .env.pass -- bun run dev
```

`.env.pass` contains literal `NAME=pass/entry` mappings, not dotenv values or
shell expressions. Select the needed entries, not the entire inventory.
See [pass-contract.md](pass-contract.md) for precedence, bytes, and runtime
failure semantics; [maintenance.md](maintenance.md) for private insertion,
editing, and migration.

Verify the intended authenticated operation without printing secrets. A child
presence check proves injection, not issuer validity. `pass-env` keeps normal
cwd/environment/stdio; a child can disclose its environment and same-user
processes can read the store. This is accidental-output prevention, not a
sandbox.
