---
name: principle-deeper-not-bigger
description: "Scoping, briefing or tempted to add: apply the Grug lens and deepen the method while keeping the outcome fixed."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Overengineering or scope drift (16 corrections) and data-fidelity loss (15), initiative #533 audit."
  source: "misty-step/mistystack#533 Q4; Felix Rieseberg, How to be more ambitious (2026-10-13); misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-subtract-before-you-add; Phaedrus t2228u via Maren (Grug lens); cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-redesign-from-first-principles"
  sunset: "2026-11-27"
---

# Deeper, not bigger

Hold the user's outcome fixed. Ambition means a better method, not more features.

Ask what the top practitioner would do, what raw material they would inspect, which instruments they would use and what outside observation would prove the result.

Configure before coding; reuse before building; delete before adding. Preserve raw data instead of replacing it with a convenient summary.

Use Git's commits, branches, refs and notes for work state before forge ledgers or a second tracking mechanism.

## Grug lens

Before adding anything, ask: Is this over-engineered? Does it add process or indirection? Why not something simpler and more direct?

Code is a liability: get the maximum outcome with the minimum code surface. Use tools as shipped. Add a wrapper, gate or check only for a linked, measured failure of the plain tool. Delete a layer before adding one.

Give each new mechanism one owner. Remove the cause instead of adding a gate; retire a check once its replacement is proven. Keep an abstraction only when its concrete prevented failure earns its cost. Redesign from the current requirements when a new one breaks the design's premise, rather than bolting it on.

Return independent new work to scope, not the current diff. A plausible improvement can be skipped rather than becoming a ticket.

Done when the same outcome has a stronger Oracle and less unnecessary machinery.
