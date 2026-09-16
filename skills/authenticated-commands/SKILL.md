---
name: authenticated-commands
description: Run authenticated scripts with API tokens or local pass entries, .env.pass references, and migrated project environments through pass-env; safely maintain authorized values and references.
---

# Authenticated commands

Keep working native tool authentication (for example, `gh` or `wrangler`). When a
command needs environment credentials from the local pass store, use
`pass-env`; credential values do not need to be inspected. This standalone Bun
CLI needs pass/GPG, not an OMP SDK, login, or session. It preserves ordinary
cwd/environment/stdio. Harnesses with Agent Skills support discover it
automatically when installed; it also reads as ordinary Markdown.

1. Find entry names with `pass-env list [prefix]` or
   `pass-env list [prefix] --json`. Listing does not decrypt entries.
   Workstation-wide values conventionally use a local namespace such as
   `workstation/API_TOKEN`.
2. Bind only the environment names the authorized command needs, inline or from
   a names-only reference file. Prefer those narrow mappings over exporting a
   whole store or the whole environment.

   ```sh
   pass-env run -e API_TOKEN=workstation/API_TOKEN -- ./scripts/sync
   pass-env run -f .env.pass -- bun run dev
   ```

   `.env.pass` is a reference file, not a dotenv file of values:

   ```text
   # Local pass entry names only
   API_TOKEN=workstation/API_TOKEN
   DATABASE_URL=projects/example/database-url
   ```

   Blank lines and full-line comments are allowed. Mappings are literal data:
   no shell evaluation, quoting syntax, or interpolation. Repeated `-f` files
   apply in order, then explicit `-e` mappings override them. Duplicate names
   within one reference file are rejected. Long flags are `--env-file` and
   `--env`. Mapped values override inherited environment variables; other
   environment variables and the working directory remain unchanged. Personal
   names-only files such as `~/.config/pass-env/workstation.env.pass` stay
   outside repositories as static inventories, not authoritative live indexes.
   Select needed entries rather than passing the full inventory.
3. Use values-only pass entries: exact UTF-8 bytes, no `NAME=`, wrapping quotes,
   or notes. The entire plaintext is the value, including all newlines; this is
   not the usual first-line-password-plus-notes convention. Empty values work;
   NUL bytes and invalid UTF-8 do not.

## Authorized maintenance

Only insert, replace, rename, or remove credentials when the user authorized that
operation and target. For insertion, `pass insert -m workstation/API_TOKEN`
accepts exact stdin bytes from a private source. Use `--force` only for an
intentional authorized overwrite. Keep values out of arguments, history,
transcripts, logs, and references; never copy secret text through the model.
Do not use `echo`: it adds a newline. Default interactive `pass insert` also
encrypts `echo "$password"` in the installed pass implementation; `-m` streams
stdin directly. Include final newlines only if they belong to the value.

For human editing, `EDITOR=nvim pass edit workstation/API_TOKEN` edits an existing
entry or creates a new one. Enter only the value. For a single-line token without
a final newline, run `:setlocal nofixeol noeol` then `:wq`. Do not remove intentional
newlines from multiline values. A human can inspect with `pass show` in a private
terminal or copy the first line with `pass show --clip`; neither is an agent
verification step, and the clipboard/history can disclose the value.

Verify by listing the entry name, then run a child that checks an intended property
or performs the authorized operation, reporting success/failure without plaintext.
A presence-only child proves injection, not validity with the issuer. Never dump
the child environment.

Use ordinary `pass mv old/entry new/entry` or `pass rm old/entry` for authorized
renames/removals. Update `.env.pass`, static inventories, scripts, and native
consumer references together. Local deletion does not revoke an issuer token;
revocation/rotation is separate authorized work. Mapped values override inherited
variables only in newly launched children. Neither editing the store nor renaming
an entry updates already running processes; restart callers as appropriate.
There are no extra `pass-env` management subcommands.

## Runtime boundaries

For a migrated project, change its launch path to `pass-env run -f .env.pass --
...` before removing an app-consumed `.env`. Reference files do not automatically
replace dotenv loading or files an application reads directly.

Missing entries and locked keys are ordinary runtime states. The launcher fails
before starting the command when lookup fails and uses noninteractive GPG
(`--batch --pinentry-mode error`), so it never waits for pinentry; a typical
local setup dedicates a passwordless key so nothing needs unlocking. Report the
affected entry name and let the human provide the entry or handle the key
through their normal pass/GPG flow; then retry the intended command. It does not
repair native auth.

Stdin, stdout, and stderr remain normal, interactive child streams. The launcher
does not print values, but a child can print or otherwise use its environment,
and any process running as the same user can read the store. This workflow
prevents accidental launcher output; it is not isolation or a sandbox.
