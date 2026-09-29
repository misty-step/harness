# ADR-027: Anthropic for Pi only through OMP's gateway, and slot sign-ins

Accepted 2026-09-29 (US-014, US-045). Status: gateway prepared, not yet
proven; Pi stays on OpenAI, xAI and OpenRouter (ADR-025) until it is.

## Anthropic

Anthropic returns a 400 to Pi ("third-party apps draw only from paid extra
usage"). Pi already sends Claude Code's identity headers and system block, so
the refusal is not about header shape, and Pi will not add more mimicry. OMP is
accepted on the same accounts. The mechanism to reuse is OMP's auth-broker plus
auth-gateway: the gateway takes an Anthropic Messages request, dispatches it
through OMP's own `pi-ai` client, and the broker is the single refresher. Pi
handles no Anthropic token.

Two rules follow from the operator decision. Never migrate, import or serve
OMP's live grants (`omp auth-broker migrate|import`, or `serve` on
`~/.omp/agent/agent.db`): a second refresher on a live grant can sign OMP out,
and OMP's Anthropic accounts carry the fleet. The broker therefore runs on an
isolated store, `PI_CODING_AGENT_DIR=~/.local/state/omp-anthropic3-broker`, and
holds only a fresh sign-in of the third Anthropic account, which has no
credential on this machine today. Never enable extra usage or bind an
Anthropic API key.

Prepared (user units, loopback only, `MemoryMax=768M`):
`omp-anthropic3-broker.service` on `127.0.0.1:18771` and
`omp-anthropic3-gateway.service` on `127.0.0.1:18772`, both with the isolated
`PI_CODING_AGENT_DIR`. Only the browser sign-in remains:
`~/.local/state/omp-anthropic3-broker/login.sh` (the command is pre-typed in
the herdr tab `ANTHROPIC-3`). The token files it creates
(`~/.omp/auth-broker.token`, `~/.omp/auth-gateway.token`) are new files; OMP does
not read them while `OMP_AUTH_BROKER_URL` is unset.

Gate: after the sign-in, one cheap single Anthropic Messages call from Pi to
the gateway. If Anthropic returns the same 400, record it here, stop the two
units, delete the isolated store, and leave Pi on its current routes. If it
succeeds, a follow-up adds an `anthropic-pool` and lifts the Anthropic refusal
in `failover`, US-045's no-go and ADR-025. The first two Anthropic accounts stay
OMP-only until the broker path is proven for one.

## Extra Pi slots: sign-ins

Each slot needs one browser or key sign-in inside Pi; nothing is copied from
OMP. Run `pi`, then `/login`, and choose the entry:

1. `OpenAI Codex (account 2)`, then `(account 3)`, then `(account 4)`: OpenAI
   OAuth in the browser, signing in with a different ChatGPT account each time.
2. `xAI (account 2)`: xAI OAuth (Grok or X Premium account).
3. `OpenRouter (account 2)`: choose the API key method and paste the second
   key.

Check with `/pool` (each account shows `signed in`). Confirm what served a
call with `cat ~/.pi/agent/account-pool.json` after `pi -p --model
openai-pool/gpt-6-astra "ok"`: the account with a fresh `lastUsed` served it.
Do not raise any OpenRouter key limit without the operator; the personal key
is at its weekly limit.

Slots resolve an API key only from their own stored credential, never from
the environment, so an unsigned slot is skipped rather than counted twice.

## Result, 2026-09-29

After the operator signed the personal Anthropic account into the isolated
broker (one credential), a single Anthropic Messages request to the gateway
(`POST 127.0.0.1:18772/v1/messages`, `anthropic/claude-haiku-4-5-20251001`,
16 max tokens) returned HTTP 200 with `ok`; no 400 and no extra-usage
refusal. `omp token anthropic --list` still showed OMP's three accounts. The
call was a plain HTTP request to the gateway, so a Pi session has not yet
been run through it: the gateway re-issues the request with OMP's client, so Pi's request shape
is not what Anthropic saw.

Smallest follow-up (not built): an `anthropic-pool` provider in `accounts` whose
member streams a Pi `openai-completions`/Messages request to the gateway with
the gateway bearer, plus lifting the Anthropic refusal in `failover` for that
provider only, then one real Pi turn as the gate. Restart after reboot:
`systemctl --user start omp-anthropic3-broker omp-anthropic3-gateway` if the
units are persisted; they were created with `systemd-run` and are transient,
so recreate them with:

```sh
D=$HOME/.local/state/omp-anthropic3-broker; OMP=$(readlink -f $(which omp))
systemd-run --user --unit=omp-anthropic3-broker --property=MemoryMax=768M \
  --setenv=PI_CODING_AGENT_DIR=$D --working-directory=$D $OMP auth-broker serve --bind=127.0.0.1:18771
systemd-run --user --unit=omp-anthropic3-gateway --property=MemoryMax=768M \
  --setenv=PI_CODING_AGENT_DIR=$D --setenv=OMP_AUTH_BROKER_URL=http://localhost:18771 \
  --working-directory=$D $OMP auth-gateway serve --bind=127.0.0.1:18772
```

Both read bearer tokens from `~/.omp/*.token`, files they created; never run
`--regenerate`.

Correction: the 200 was a raw HTTP call, not a Pi session, so the Pi verdict
is still open. OMP's `agent.db` grew from 8417280 to 8531968 bytes after the
sign-in, but OMP was running throughout and the broker's own store is a
separate file; `omp token anthropic --list` shows the same three accounts
seen before the test call. The pre-sign-in list was not captured, so this
does not prove the store is unchanged.
