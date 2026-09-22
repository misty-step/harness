# Journey capability

Capture product-specific knowledge that a fresh agent would otherwise have to
rediscover. For each supported outcome, make its relevance, required target/data/
identities/authority, intended interaction surface, observable correctness,
inspection points, limitations, and owned cleanup discoverable. Use the product's
natural conventions; this is not a required document template or receipt schema.
Link current commands, fixtures, and documentation. Keep detailed journeys on
demand rather than in a large root; never persist ephemeral accessibility refs.

## Helpers and surfaces

Add a helper only for recurring application-specific work, such as fixture setup,
runtime selection, a difficult state, or waiting for an observable condition.
Keep it with its owning product and existing CLI/API conventions. Failures need
actionable diagnostics and bounded waits. Add machine-readable output when a
consumer needs it, or inspection/dry-run when useful for a consequential operation;
a dry-run is not authorization to perform that operation.

Use supported APIs for setup and inspection, but exercise rendered interaction
when the claim concerns the UI. A CLI needs its actual commands, a library an
executable consumer, and a desktop application its actual surface. Controlling
state, observing it, and deciding correctness are distinct capabilities.

## Meaningful checks

Define observable postconditions that reject plausible failure, including
persistence, rejection, recovery, or timing where consequential. Use deterministic
assertions for stable contracts and live interaction where required. Screenshots,
self-reports, schema-valid receipts, and passing unit tests are not interchangeable
proof. Reuse sound checks and evidence rather than introducing a universal receipt
protocol.

For a new correctness check, establish that it rejects a plausible failure in an
isolated exercise where practical. Keep a regression test when it protects a real
uncertain contract, not skill wording or an artificial coverage target. Changes
to setup, identity, navigation, behavior, or cleanup should update their affected
verification path, not regenerate accurate surrounding knowledge.
