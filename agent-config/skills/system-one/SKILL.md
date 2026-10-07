---
name: system-one
description: Use the official TypeSafe skill with the fleet's OpenRouter credentials and deployed Jev integrations.
version: 0.3.0
license: MIT
---

# Fleet Jev integration

`skill://typesafe-ai` owns judgment design, primitives and confidence; this
companion owns only fleet wiring. Every fleet Jev call goes through OpenRouter
Decisions, never chat completions or the direct TypeSafe endpoint and
`TYPESAFE_API_KEY` shown in upstream examples. [references/fleet.md](references/fleet.md)
has credentials, the pinned model and existing consumers; reuse them rather than
`npx skills add`.

Verify on the actual decision path and record the resolved model, elapsed time
and typed answers. Keep credentials out of state. Service failure leaves the
caller's usable default; advisory decisions never authorize side effects.
