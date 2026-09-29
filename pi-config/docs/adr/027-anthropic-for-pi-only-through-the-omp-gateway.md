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
