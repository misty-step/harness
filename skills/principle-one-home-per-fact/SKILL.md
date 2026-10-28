---
name: principle-one-home-per-fact
description: "Adding a fact, term, setting or document: choose one owner and migrate its references."
disable-model-invocation: true
metadata:
  owner: phaedrus
  prevents: "Data-fidelity loss and duplicates; 15 operator corrections and ADR-004 drift evidence."
  source: "misty-step/mistystack#533; misty-step/foundations@d96c99ce1152ab1d6ae4a0eed0b22cbac93897b7/way-of-working.md#build; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-migrate-callers-then-delete-legacy-apis"
  sunset: 2026-11-27
---

# One home per fact

Put a fact where it is owned. Other consumers reference that home rather than keeping a synchronized copy.

Use DOMAIN.md for project terms and those terms in code, briefs and review. Resolve conflicting meanings before multiplying names.

Treat config, types and executable commands as sources. A document that repeats an easy lookup is a cache to remove, not another authority.

For a replacement, inventory code, strings, tests, links and generated inputs; migrate every caller and delete the old path in the same unit.

Preserve an external compatibility contract only when it is genuinely promised; name that contract rather than keeping an accidental internal alias.

Done when a fact can change in one owned place and all consumers use it, and the migrated consumer path passes.
