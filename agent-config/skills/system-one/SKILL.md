---
name: system-one
description: Use the official TypeSafe skill with the fleet's OpenRouter credentials and deployed Jev integrations.
version: 0.3.0
license: MIT
---

# Fleet Jev integration

Read `skill://typesafe-ai` for TypeSafe's official judgment design, primitives,
confidence, and live documentation. That upstream skill owns the programming
model; this companion owns only our fleet wiring.

All fleet Jev calls go through OpenRouter Decisions, not chat completions or
the direct TypeSafe endpoint shown in upstream examples. Read
[references/fleet.md](references/fleet.md) for credentials, the pinned model,
and existing OMP/Pi/Hermes consumers. Reuse those paths rather than installing
a second copy with `npx skills add`.

Exercise the actual decision path, record the resolved model, elapsed time,
typed answers and confidence where present, and keep credentials out of state.
Service failure leaves the caller's explicit usable default; advisory decisions
never authorize side effects or veto tools.
