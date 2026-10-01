# pass-env contract

The standalone Bun CLI needs pass/GPG, not a harness SDK or session.

Reference files allow blank lines and full-line comments. Mappings are literal:
no shell evaluation, quoting, or interpolation. Repeated `-f` (`--env-file`)
files apply in order; explicit `-e` (`--env`) mappings override them. Duplicate
names within one file are rejected. Mapped values override inherited variables;
other environment variables, cwd, and interactive stdio remain unchanged.

Pass entries contain exact UTF-8 value bytes: no `NAME=`, wrapping quotes, or
notes. The whole plaintext, including newlines, becomes the value. Empty values
work; NUL and invalid UTF-8 do not. This differs from pass's common
first-line-password-plus-notes convention.

Lookup failure stops the child before launch. GPG uses
`--batch --pinentry-mode error`, so a locked key never waits for pinentry. Report
the affected entry after completing credential discovery; key unlocking belongs
to the normal pass/GPG flow. The launcher does not repair native authentication.

Mappings affect newly launched children only. Store edits and renames do not
update running consumers. Reference files do not replace dotenv loading or
application-read files automatically: migrate the launch command before removing
an app-consumed `.env`. There are no pass-env credential-management subcommands.
