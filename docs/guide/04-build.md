# 4. Build

Use [misty's playbooks](../../skills/misty/SKILL.md) for the kind of work in hand. Keep the project's domain names and public behavior intact while changing its implementation.

[Ship-loop](../../skills/ship-loop/SKILL.md) carries a shaped slice through building, proof and review. Rigor roles describe the work independently of a model; model and runtime choices belong in harness-native configuration, not the method. The [OMP reference](../../skills/misty/harnesses/omp.md) owns the shipped adapter's mapping.

Give independent workers independent slices with the same outside check and explicit boundaries. Place each slice's execution with [boat-workers](../../skills/boat-workers/SKILL.md). Bring their work together before running shared checks. A blocked part does not stop work that can finish safely.

Next: [Verify and ship](05-verify-and-ship.md).
