# Canonical T3 account roster

This CLI-only feature has no product sign-in. It uses no QA credentials.

From the checkout root, run the affected consumer journey on Hetzner:

```sh
remote-run build --image python:3.12-slim -- sh -c 'python3 -m unittest discover -s t3-accounts -p "test_*.py" -v'
```

The suite installs the candidate into a disposable HOME and invokes
`t3-accounts roster --json` as Upkeep or Fleet does. It checks all seven managed
accounts, four explicit unknown-email watch-only rows, aliases, source-host
references, and missing or invalid input. It checks output for synthetic secret
sentinels and compares scratch state before and after each command. Native
credential commands are replaced with rejecting stubs. The suite cleans its own
HOME and never installs on a live host or copies native credentials.

For the real authority, invoke the candidate executable directly on Mirrodin,
parse its output privately, and retain only counts and reference-shape assertions
as evidence. Expect four Anthropic, three Codex, and four watch-only rows at the
time of this slice. Do not retain emails, source paths or raw JSON in public
proof. This read is not a live installation and does not run legacy `status`,
which synchronizes helper files. Never run `sync`, `watch`, or `claude-renew`
as verification of the roster command.

Link the checked revision, remote command and result in the PR. No web, provider
login or inference journey is affected by this command.

## Exhaustion and recovery events

The same suite installs `t3-accounts room-watch` into a disposable HOME and
feeds a synthetic live-room command. A rejecting Home stub leaves a pending
event on disk; a successful retry delivers it once. The tests also exercise
unknown, expired, future, reset-lapsed, repeated, and recovered observations.
They do not access native credentials or call a provider.

After the reviewed authority install, run `t3-accounts room-watch` once and
check the `t3-accounts-room-watch.timer` result. For real sender verification,
use a dedicated scratch state and synthetic account names with the installed
`t3-accounts-room-events` command, explicitly label the Home messages as QA,
and read them back through `home inbox`. Retain the Home post identifiers and
remove the scratch state. Do not change the authority's actual state to force
an exhaustion or recovery event. Link the source and observation time in the
retained proof. Verify that no duplicate event appears on a second run.
