# Refactor

1. **Pin behavior.** Identify the consumer contract and a characterization, replay or equivalence check outside the reshaping code. Read the `test-audit` skill. **Complete when:** the check observes current behavior through its owner boundary and is recorded before structural edits.
2. **Name the missing shape.** Read the `principle-deep-modules` skill and the `principle-model-the-domain` skill. Keep clear local code; choose a reshape only where it removes branches, repeated rules or invalid states. **Complete when:** the target interface and the concrete reduction in reader load are stated.
3. **Subtract and migrate.** Read the `principle-one-home-per-fact` skill; delete obsolete layers, move all callers and remove the replaced API in the same unit. Apply misty's delegation boundary when a mechanical unit merits delegation. **Complete when:** code, strings, tests and documentation use the target names and no compatibility path remains.
4. **Prove equivalence.** Run the pinned check against the changed artifact and drive the affected consumer path through the `verification` skill. Route newly discovered behavior changes to a separate bug-fix or feature unit. **Complete when:** old and new observations agree on the promised contract and the changed structure reduces reader load.
5. **Deliver.** Use the `ship-loop` skill. **Complete when:** the unit links the behavior pin, equivalence result, removed complexity and any excluded behavior change under the core's claim rule.

Source: cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-redesign-from-first-principles; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/poteto-mode/playbooks/refactoring.md.
