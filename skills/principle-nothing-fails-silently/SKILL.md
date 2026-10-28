---
name: principle-nothing-fails-silently
description: "Error paths, fallbacks or telemetry: expose the failure and emit one terminal outcome per run."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Silent failure; Foundations article 8 and mistystack docs/principles/009 evidence."
  source: "misty-step/mistystack#533; misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md#fail-loudly"
  sunset: 2026-11-27
---

# Nothing fails silently

Choose one direct path. When it fails, expose the cause to its owner so the defect can be repaired.

Keep authentication, signature and schema guards at their boundaries and fail visibly. A masking fallback that turns a defect into apparent success is not recovery.

A routing or decision system may need a reasonable default for an unknown case; surface that choice loudly for design iteration.

An explicitly chosen, logged operating alternative is a new action, not a hidden success. Preserve the failed action's result rather than overwriting it.

Emit one terminal outcome per run, with enough attribution to distinguish success, rejection and failure. Exercise the failing path, not merely the installed telemetry SDK.

Done when a consumer can observe the failure and the owner can trace its cause.
