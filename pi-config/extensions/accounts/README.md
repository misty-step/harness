# Accounts and the native OMP Codex owner

`openai-pool` now sends raw inference to the existing `omp auth-gateway stdio`
command. OMP's default local grant store owns Codex account selection, quota
blocks, normal refresh and pre-output recovery. Pi still owns its agent loop,
local tools and tool results. No OMP agent, HTTP listener, gateway token,
credential copying, login or replacement pool store is involved.

The child uses the OS user's home/default OMP directory. Its environment is an
allowlist of PATH, locale/timezone, TMPDIR and XDG paths, with HOME from the OS;
provider keys, credential overrides and Pi/OMP profile variables are not inherited.
Before dispatch it reads `retry.modelFallback` through the native JSON config
interface and
refuses inference unless the value is explicitly false. It never changes that
setting. Models are literal `openai-codex/<id>` selectors; Pi's existing model
policy and Sol/xhigh default remain unchanged. Existing native account policy
still applies; the adapter invents no account exclusions.

## Protocol and limits

Each inference owns one STDIO child and one id-correlated `/v1/pi/stream`
request. The body uses a top-level **string `model`**, not `modelId` or a model
object. Pi's native transcript helpers fold system sections/tool declarations
into OMP's context; user, assistant, image and tool-result messages remain
structured. Serializable options are forwarded, except client auth, headers
and abort signal; provider environment overrides and unsupported callbacks
are rejected locally.

Pi 1.2's `onPayload` bridge is awaited **locally before native dispatch**.
This runs the unchanged `before_provider_request` model guard; cancellation
settles even while a hook is pending. The hook receives the adapter's canonical
`{model, context, options, stream}` body, not an upstream OpenAI payload.
Undefined keeps the body (including in-place mutations); a replacement may
change canonical context or `maxTokens`/`reasoning`, but must preserve the
literal held Codex selector, streaming mode and all other options. Unsupported
vendor-payload transforms, callbacks or route changes fail before inference;
direct callback errors also settle without dispatch. Pi's SDK continues to own
extension-handler error handling.

`onResponse` observes the native gateway's transport status with empty headers
(STDIO does not export upstream HTTP headers), not an invented upstream
response. `onProviderStreamEvent` observes original buffered native records.
These callbacks run locally; no functions are serialized to the owner.
Pi 1.2 also passes its agent-loop controls in provider options. Tool guards,
turn completion, context preparation and queue callbacks remain executed by
Pi; they are neither invoked again nor forwarded to OMP.

**Native STDIO buffers the complete SSE response.** First output arrives only
after provider completion, not at provider time-to-first-token. The adapter
then forwards the original native events and deltas; it does not synthesize
chunks or resend failed requests. Abort kills only that call's child and
settles the Pi stream. OMP's native driver owns 401/usage-limit recovery before
output and refuses native replay after non-start output. Existing Pi retry
and model-failover behavior is not replaced by this transport.

Successful final messages retain the native provider, model, usage,
`credentialId`, signatures and provider payload. The serving status names the
successful native row; it is not a guessed account or a list of failed rows.
Native STDIO exports neither the failed-account sequence nor an ai-usage
revision. Transport/protocol failures and aborts do not invent serving rows.

## Inventory and other providers

`/pool` reads `omp usage accounts --json` metadata once. It labels native OMP
Codex identities as **configured**, with quota availability unknown, and
separately lists Pi-local xAI/OpenRouter accounts and blocks. A single stored
Pi login is not the shared OMP pool. The existing ai-usage dated advice remains
the capacity view; native owner inventory/cache metadata is not its source
revision or fresh headroom evidence.

Non-OpenAI slots/pools keep Pi's original local rotation. Explicit Pi-native
OpenAI/Codex slots and their logins remain user-owned; they are not the
`openai-pool` execution path. Legacy OpenAI rows in `account-pool.json` are not
consulted by the shared pool and are not deleted.

## Source custody and checks

`index.ts` registers the provider and `/pool`; `native.ts` owns child transport;
`pool.ts` still owns other providers' local rotation. Install only this package
from a reviewed revision with `PI_CONFIG_COMPONENTS=accounts pi-config/install`.
No config/guidance/auth deployment is needed. Use a fresh Pi invocation.

`bun test pi-config/extensions/accounts/` exercises local protocol fixtures,
including structured tools/results, buffered events, post-output errors, abort,
native JSON config and no client retransmission. **Fixtures are not live quota
or failover proof.** A genuine unavailable-account bypass still requires an
actual unavailable native subscription plus a successful included sibling
response and native account attribution; a healthy response alone does not
prove it.

With `PI_NATIVE_SDK_ENTRY` unset, Bun's `test.skipIf` skips only the installed-SDK
integration; portable protocol and local request-hook cases still execute.
Set it to the installed Pi 1.2 `dist/index.js` to execute (not skip) the real SDK
bridge, unchanged model guard and tool continuation against an **offline**
gateway. Policy-fix review requires this SDK-configured run; a portable skip
is not integration proof. Synthetic keys test child-environment isolation;
no stored grants or live model requests are used. Run-scoped TMPDIR keeps
fixtures private.
