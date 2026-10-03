# Credential maintenance

For authorized insertion, stream exact private bytes into
`pass insert -m workstation/ENTRY`; `echo` and interactive insertion add a newline.
`--force` intentionally overwrites. For single-line nvim edits without a newline,
`:setlocal nofixeol noeol` then `:wq`.

Update project mappings and consumers on authorized rename/removal; restart them.
Deleting a local entry does not revoke its issuer token. Use an authenticated
operation to verify, not plaintext output.
