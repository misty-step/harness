---
name: principle-model-the-domain
description: "Consequential state, lifecycle logic or growing branches: model states and transitions before implementation."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Invalid-state and interleaving gaps covered by Foundations article 11, initiative #533."
  source: "misty-step/mistystack#533; misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md#build; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-model-the-domain"
  sunset: 2026-11-27
---

# Model the domain

Name states, events, invariants and owners first. Keep one transition table for consequential state rather than scattered booleans and lifecycle branches.

Use DOMAIN.md terms. Choose a discriminated union, typed model, registry or statechart that makes invalid states unrepresentable and matches actual access patterns.

Keep simple CRUD simple; prefer native transactions to custom coordination. Use history projections only when audit, replay or recovery is part of the story.

Before actors share state, ask what another writer can change concurrently. Isolate their targets unless the domain requires shared ownership.

Where bad orders hide in interleavings, run the model check and show it rejects a broken variant; reading a chart is not that check.

Done when the shape owns the rules, transitions have one home and the real consumer Oracle passes. Label the result measured, inferred or guess.
