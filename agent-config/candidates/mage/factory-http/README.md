# summon-http-client — owned, stateless gateway consumer

Shared by Mage and the Pi runtime CLI, **not** their native transport/spool or
execution engine. Imports canonical `summon-protocol` from frozen Core268; no API
schema copy, server policy, grant, ledger, scheduler or native callback service.
The same primitive owns both HTTP paths; Pi never depends on Mage's executable,
Unix spool or inbox. No installer selects it.

Both consumers accept the same explicit commands:

```sh
mage factory client.json read cf1:existing status
summon-pi-runtime factory client.json read cf1:existing authority
# Also read: view, packet (this is a run packet, not a hosted collector rollup).
# Explicit SINGLE submission of ORIGINAL canonical request bytes:
mage factory client.json send cf1:existing input original-input.json
summon-pi-runtime factory client.json send cf1:existing reconcile original-observation.json
```

These commands DO NOT invoke Pi, claim automatically, abort a native process,
change a profile/loadout, submit returned observations automatically, or infer
native ACK, task admission, termination, verification or factory acceptance.
The existing non-HTTP CLI and local native owner rules remain unchanged.

Config contains an explicit bare HTTPS origin, requested canonical
`AuthorityBinding` and optional **environment-variable NAME**, never credentials:

```json
{
  "origin": "https://owner-configured-authority.example",
  "binding": {
    "instance": "owner-selected-instance",
    "namespace": "owner-selected-namespace",
    "account_id": "owner-selected-account",
    "project_id": "owner-selected-project"
  },
  "assertion_env": null,
  "loopback_fixture": false
}
```

A requested scope is not a principal/grant. No actor, policy, JWKS URL or verified
identity can be supplied by this client. It sends `x-summon-authority`; an optional
owner-provided, approved Access assertion uses `cf-access-jwt-assertion`. This is
not a native OAuth/cookie/keychain reader or sign-in/refresh flow. No service
selector, service enablement, secret issuance/movement or entitlement is implied.
Missing named assertion refuses, without login, alternate-account or paid fallback.
Root owns actual credential provisioning, granted issuer shapes, server admission
and deployed consumer verification. No real assertion was read or supplied in
this source slice.

Success requires exact response scope and server-attributed actor headers,
canonical response shape and matching run/version/authority. The original creator
in an authority body can differ from the current reader actor; owner provenance is
preserved. Verified signature, principal/action grants and actor attribution remain
server facts, not client authorization or merely parsing a header.

| Client operation | Canonical gateway capability |
| --- | --- |
| GET status/view/packet/authority | Read |
| POST intake | Intake |
| POST input | Steer |
| POST hold/cancel | Hold/Cancel |
| POST claim | Claim (no native execution) |
| POST observe/reconcile | NativeFacts |
| POST metadata | Metadata |

Proof submission is not exposed while issuer/actor admission remains owner work.
Hosted supplied-record projection/archive endpoints do not exist in Core268;
this client does not invent them or fall back to the local unauthenticated ones.

TLS certificate verification is enabled with Rustls/public trust roots. No
insecure mode, ambient proxy, cookie jar, connection reuse, redirect, retry,
credential debug output, lease or automatic resend. HTTP is accepted ONLY for an
explicit IP-loopback fixture, with the SAME response binding requirements.
Bodies/config are bounded at512KiB; responses4MiB; global request budget5 seconds.
The timeout does not mean a command was rejected or a native process terminated.
POST transport/refusal/incomplete/wrong-scope/invalid-reply errors preserve unknown
acceptance. Caller retains original immutable IDs, exact body and applicable
expected revision, then explicitly reads/reconciles. No blind resend, new ID,
claimed native ACK or second invocation follows a lost response.

## Checks and evidence bounds

```sh
export TMPDIR=/absolute/run-scoped/scratch CARGO_BUILD_JOBS=2
export CARGO_TARGET_DIR="$TMPDIR/client-http-target"
cargo test --offline --locked --manifest-path agent-config/candidates/mage/factory-http/Cargo.toml -- --test-threads=1
# After building both owned CLIs, exercise their REAL factory branches:
MAGE_BIN="$CARGO_TARGET_DIR/debug/mage" \
PI_RUNTIME_BIN="$CARGO_TARGET_DIR/debug/summon-pi-runtime" \
cargo test --offline --locked --manifest-path agent-config/candidates/mage/factory-http/Cargo.toml both_owned_cli_read_paths -- --ignored --test-threads=1
```

TCP fixtures prove exact route/scope/original POST bytes, refusal, redirect
non-follow, one-request lost-response uncertainty, and distinct creator/reader
provenance. Opt-in actual Mage/Pi CLI reads prove both consumer branches WITHOUT
starting native Pi or any model. They are NOT real JWT/grant, remote TLS handshake,
deployed DO, native/cloud account entitlement, service admission or Bot proof.
No provider task, Cloudflare credentialed operation or deployment is tested here.
