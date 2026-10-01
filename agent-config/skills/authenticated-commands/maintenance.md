# Credential maintenance

For an authorized insertion, stream private source bytes directly into
`pass insert -m workstation/API_TOKEN`. Keep values out of command arguments,
history, model context, logs, and reference files. `--force` is an intentional
overwrite, not an insertion default.

`echo` adds a newline; the installed interactive `pass insert` also encrypts
`echo "$password"`. `-m` preserves stdin bytes. Include a trailing newline only
when it belongs to the value.

For human editing, `EDITOR=nvim pass edit workstation/API_TOKEN` creates or edits
an entry. For a single-line token without a final newline,
`:setlocal nofixeol noeol` then `:wq` preserves that shape. Multiline values may
need their newlines. `pass show` in a private terminal and `pass show --clip`
(first line) are human inspection options, not agent verification; clipboard
history can disclose values.

Authorized renames/removals use `pass mv old/entry new/entry` and
`pass rm old/entry`. Update `.env.pass`, static inventories, scripts, and native
consumer references together, then restart affected callers. Local deletion
does not revoke the issuer's token. Verify an intended operation without
plaintext output, not merely that the entry exists.
