# T3 access watchers

`t3-agent` consumes existing credentials and never issues them. The separate
`t3-access-renew` command renews only explicitly approved read-only watcher
grants, through each host owner's existing SSH login and native T3 issuer.
It needs Python 3.11+, SSH, pass, pass-env, t3-agent and Home on PATH.
GPG must already be usable unattended. Renewal disables pinentry prompts and
reports a locked or unavailable key instead of waiting for operator input.

## Private configuration

Keep the catalog and receipts outside Git. Add a renewal binding to each
approved server in `~/.config/t3-agent/watchers.toml` (at most four):

```toml
[[servers]]
id = "t3-example"
url = "https://example.test/mcp"
token_env = "T3_WATCH_EXAMPLE"
token_pass = "workstation/t3-access/watch-readonly/example"
[servers.renewal]
host = "example"
ssh = "owner@example.test"
base_dir = "/home/owner/.t3"
```

`~/.local/state/t3-agent/approved-credentials.json` records prior owner approval
and token-free current receipts. This command does not provision initial grants:

```json
{
  "approval": "Owner approval reference for these watchers and same-scope renewal",
  "credentials": {
    "watcher/example": {
      "host": "example",
      "role": "watcher",
      "subject": "mcp-client",
      "scopes": ["orchestration:read"],
      "ttl": "30d",
      "tokenPass": "workstation/t3-access/watch-readonly/example",
      "sessionId": "existing-approved-session-id",
      "expiresAt": "2030-01-31T00:00:00Z"
    }
  }
}
```

The catalog must cover exactly the watcher receipts, with unique host, server
and pass references. Other roles and historical `previous` arrays are preserved.
Each configured native store must list the tracked ID with matching subject,
scope and expiry before a new attempt. Unknown destinations or missing active
sessions fail visibly, without issuance. SSH requires existing authentication
and a known host key; it never accepts a new key automatically.

## Install and run

Install the CLI and inactive daily user units through the shared installer:

```sh
agent-config/install --agent-dir "$HOME/.agents" --t3-access-renew
```

This also installs `t3-agent`; install `pass-env` through the normal harness
selection. Install neither credentials nor private catalog examples from Git.
Set the existing `T3_ACCESS_REPORT_URL` in `~/.config/t3-agent/watch.env` to an
accessible review/evidence URL. Once deployment is authorized and the private
bindings are reviewed, the deployment agent activates the daily timer:

```sh
systemctl --user daemon-reload
systemctl --user enable --now t3-access-renew.timer
```

A direct scan uses the same command as the service:

```sh
t3-access-renew --report-url https://example.test/private-renewal-evidence
```

The timer scans daily with up to 30 minutes of jitter and catches missed runs.
Each external call has a timeout; the complete service is limited to 45 minutes.
The scan locks the receipt file, lists current sessions, and leaves grants with
more than seven days remaining untouched. Due grants always use exactly:

```text
auth session issue --base-dir <approved-base>
  --subject mcp-client --scope orchestration:read --ttl 30d
  --label t3-access:watch-readonly:<host>:<attempt> --json --log-level none
```

Candidate output stays in memory and encrypted pass storage. Native pass
encrypts in a private scratch directory with the destination's nearest recipient
configuration and signature. Only ciphertext enters the shared store and its Git
index, so pass's automatic commits cannot capture unrelated staged work. No credential is
passed in argv, logged, or written to a plaintext file. The candidate's native
metadata and 30-day lifetime must match; `t3-agent check` must successfully read
the environment and project list using that candidate before promotion to the
existing pass reference. Promotion atomically swaps the encrypted sibling `.gpg` file into the existing
pass destination (honoring `PASSWORD_STORE_DIR`, default `~/.password-store`).
A Git-backed pass store records only that destination through native `pass git`;
unrelated staged changes are preserved. Promotion and current-consumer verification precede
receipt advancement. Watchers open a fresh client on each check and pick up the
updated reference without restarting T3. No grant is revoked; predecessors
expire naturally, and historical grants are never touched.

## Errors and recovery

JSON output gives each watcher `ok`, `status` or `error`, and the attempt label
when held. Nonzero exit means a watcher failed or Home notification failed.
Failures and recoveries go to Home with the configured review link; repeated
unchanged failures are deduplicated. Failed delivery is retried on the next scan.

A token-free `renewal` marker is durably written before issuance. Its named
phases are `issuing`, `staged`, and `promoting`. Encrypted staging uses a unique
sibling pass entry named `<current-reference>-renewal-<attempt>`. Recovery always
reuses that entry and revalidates it, including after promotion before receipt
advancement. Candidate rejection leaves the current pass reference unchanged.
A failed promotion retains the attempt for idempotent retry, never another mint.
The latest successful encrypted candidate is retained as recovery material.
Its predecessor encrypted staging entry is removed before the next due
issuance, keeping successful staging bounded to one entry per watcher.

If issuance times out, its outcome is unknown. The next scan reconciles the
exact attempt label against the native list and tries only its encrypted stage.
Without that stage it returns `issuance-held`, even if the list is empty: a
remote process may still complete and native listing cannot recover its token.
The responsible agent inspects the receipt's attempt label and native store,
settles that exact attempt under the existing approval, then updates the
receipt/stage. Never delete a pending marker merely to retry issuance. No command
here broadens scopes, creates a privileged bearer issuer, handles provider
logins, or changes Grok credentials.

Verification: [T3 access recipe](../../.agents/skills/verify-harness/features/t3-access.md).
