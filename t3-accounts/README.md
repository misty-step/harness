# T3 account roster

The maintained source for `~/.local/bin/t3-accounts` lives here. The initial
adoption preserves the installed script's credential operations. The existing
`~/.local/share/t3-login/t3-login-helper.mjs` remains host-owned and unchanged.

`./t3-accounts/install` installs only this executable. It does not create or copy
configuration, credentials, helper files, or services. The root harness installer
does not install it. Deployment requires the lane's review first.

## Roster command

```sh
t3-accounts roster --json
ssh mirrodin t3-accounts roster --json
```

Mirrodin's existing `~/.config/t3-accounts/accounts.json` is the sole roster
authority for Upkeep, T3 accounts and Fleet. Other hosts query it through existing
SSH. The command reads that file once and emits JSON without subprocesses,
network calls, credential reads, authentication refreshes, or state writes.
Do not substitute a host-local partial roster when the authority is unreachable.

The output has `schema_version: 1`, `source`, `hosts`, `accounts`, and `retired`.
`source` contains the authority's `host` and the fixed configuration `path`.
`hosts` maps each configured host name to its existing SSH destination. The
sole empty destination identifies the authority. Host destinations are connection
references, not commands to execute through a shell.

Every account has these fields:

| Field | Meaning |
| --- | --- |
| `provider` | `anthropic`, `codex`, or the configured watch-only instance ID |
| `email` | Configured email, or JSON null for watch-only instances |
| `email_reason` | Null for configured emails, otherwise `not_configured` |
| `tracking` | `managed` or `watch_only` |
| `keep` | Existing watcher priority flag; does not assert availability |
| `instances` | Host name to local T3 dispatch ID, with wildcard aliases expanded |
| `credential_sources` | Existing native credential references, never values |

Managed identity is the pair `(provider, email)`. Watch-only rows have distinct
provider IDs and unknown emails. Rows retain configuration order, with Claude,
Codex, and then watch-only instances. Retired rows remain present; `retired`
contains the configured instance IDs that consumers exclude from dispatch.

Claude sources have `kind: pass`, `host`, and `entry` for each configured host.
These references name host-local pass stores and do not assert readability.
Codex has one source with `kind: codex_home`, `host`, and `home`, naming the
configured owner home. Consumers resolve references on the source host through
existing native plumbing. This command does not discover grants, transport
credentials, copy refresh tokens, or initiate refreshes.

Unrecognized configuration fields are excluded from output. Missing or invalid
configuration fails nonzero with a value-free error and no partial JSON. Invalid
arguments fail before configuration is read. The output contains private account
identities and source locations; retain it only within the authorized private
consumer boundary. It contains no live authentication or quota assertions.

The [integration contract](https://github.com/misty-step/upkeep/issues/208#issuecomment-6372432967)
and [Upkeep stories US-160 and US-163](https://github.com/misty-step/upkeep/pull/209)
record the requested shared-roster behavior.

## Owner keepalive

`t3-accounts keepalive [--force] [ACCOUNT]` refreshes Codex owner logins whose
`last_refresh` is at least three days old, then syncs readers. `--force` skips
the age check; `ACCOUNT` selects one configured account. The owner's own Codex
app-server performs the refresh. Reader homes never refresh credentials. Failed
keepalives report to Home and exit nonzero. The existing keepalive systemd timer
can continue calling `t3-accounts keepalive`.

## Plain and pull hosts

Add non-T3 machines separately from `hosts`. Keys inside `codex` must match
configured account emails; these example identities are synthetic:

```json
{
  "plain_hosts": {
    "hetzner-ci": {
      "dest": "hetzner-ci",
      "codex": {
        "main@example.test": "~/.codex",
        "r90@example.test": "~/.codex-t3/r90",
        "phraznikov@example.test": "~/.codex-t3/phraznikov"
      }
    },
    "grok-box": {
      "pull": true,
      "codex": {
        "main@example.test": "~/.codex"
      }
    }
  }
}
```

Sync pushes owner snapshots to plain SSH hosts, blanking `refresh_token` on the
owner before transport. It never overwrites a home with its own refresh token.
Health comes from `CODEX_HOME=<home> codex login status`; plain hosts receive no
T3 status calls. `roster --json` continues to describe only T3 hosts and ignores
`plain_hosts`.

Pull hosts omit `dest` because they have no inbound SSH. Their box-side
`t3-reader-pull` must periodically connect outbound to the authority and:

1. Fetch `t3-accounts reader-payload ACCOUNT` for each configured account. The
   JSON has `payload` (the owner's auth.json with a blank refresh token) and
   `label`. This output contains access credentials: pipe it privately into the
   consumer, never logs. The command refuses a snapshot with a nonblank refresh
   token.
2. Preserve any home with its own refresh token. Otherwise validate the snapshot,
   atomically write `payload` to the configured home's `auth.json` with mode
   `0600`, and keep reader metadata outside the home, under
   `~/.local/state/t3-accounts/readers/`.
3. Run `codex login status` for each home and send a token-free report on stdin
   to `t3-accounts pull-report grok-box` on the authority. The report shape is
   `{"accounts":{"main@example.test":{"live":"ready","has_refresh":false,"last_refresh":"<ISO UTC>","access_exp":"<ISO UTC>"}}}`.
   `live` must be `ready`, `unauthenticated`, or `missing`; `has_refresh` must be
   a boolean. Timestamps must be ISO strings or null. Use `unauthenticated`
   when login status fails and `missing` when no login exists.

Only configured pull hosts and their configured Codex accounts are accepted.
Invalid input exits nonzero without replacing the previous report. The authority
stamps receipt time as `at` and atomically stores the report with mode `0600` at
`~/.local/state/t3-accounts/pull/grok-box.json`. Watch flags unreadable or invalid reports, missing reports,
reports older than three hours, accounts not ready, and access tokens expiring
in less than 48 hours. A ready account without an expiry raises a low-priority
problem. Plain and pull checks, status, and plain pushes skip accounts whose
owner or host instance is retired. Sync and status never initiate SSH to pull hosts. The
box-side `t3-reader-pull` is managed separately from this executable.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s t3-accounts -p 'test_*.py'
python3 -m py_compile t3-accounts/t3-accounts
```

Run on Hetzner through `remote-run build --image python:3.12-slim -- ...`.
Tests install the actual executable into a disposable HOME, exercise seven
managed accounts and four watch-only rows, reject malformed configuration, and
check that native credentials and state remain untouched. No native credentials
are copied to the test host. The fixture identities are synthetic.
Reader tests monkeypatch host commands and use synthetic snapshots to check
plain-host login preservation, pull report health and expiry, owner keepalive,
reader-payload rejection, and roster isolation. They also exercise shell quoting,
private directory creation, report schema and path rejection, atomic publication,
unreadable stored reports, and retired-account filtering. They use no network or SSH.

## Fresh availability events

`t3-accounts room-watch` reads `upkeep room --json` and posts fresh exhaustion
and recovery transitions with `home post --from Accounts`. The authority runs
this command every five minutes through `t3-accounts-room-watch.timer`.
The existing hourly credential watcher retains its own schedule and no longer
runs its separate daily Claude probe.

Set `T3_ACCOUNTS_ROOM_URL` to the private live room evidence URL in
`~/.config/t3-accounts/room-watch.env` on the authority, then run
`./t3-accounts/install-room-watch`. The URL contains no token.
Run the installer only on the authority. Readers do not post duplicate events.

Unknown, expired, future-dated and reset-lapsed observations do not change an
account's last confirmed availability. A tiny-model probe success says only
that the named model works. Every event includes the observation time, source
and provider reset when supplied. The first confirmed exhaustion posts an
event; the first healthy observation establishes the baseline silently.

Before delivery, the watcher atomically saves transitions and pending events
under `~/.local/state/t3-accounts/room-events.json`. Failed delivery leaves the
pending event for the next run. A crash after Home accepts an event but before
the acknowledgement is saved can repeat that event with the same event ID.
A file lock serializes concurrent runs on the authority.
