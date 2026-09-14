# Operating foundations

Use the concerns that bear on this project's direction or transition. A private
utility and a live multi-user product need different foundations; absence alone
does not justify a new platform or work item.

## Ability to change

Can a fresh agent exercise the core user outcome or consumer contract, distinguish
success from plausible failure, and clean up in an authorized environment? Inspect
repository-owned procedures, commands, representative data, isolated identities,
and external-service dependencies where they affect that answer. A skill file,
successful tool invocation, or historical receipt does not establish capability.
Missing or unreliable verification is a development constraint; recommend the
smallest repair. Creating it requires a separately commissioned
`verification-infrastructure` pass.

Judge checks, local development, CI, builds, and recovery by consequential failures
they catch or prevent, not tool count. Assess reproducibility or a retained preview
only where the development workflow needs it. Documentation and backlog should
preserve intent and ownership without competing sources of truth.

## Hosting and transition

Separate changing hosts from changing database, identity, real-time, or job
contracts. Compare local, edge-native, and persistent Linux execution when those
choices matter; a hybrid must remove more work than its boundary adds. Current
deployment evidence—not old hosting declarations or a separate local
implementation—establishes whether a cutover is complete.

Account for migration safety, artifact identity, recovery, and operator ownership.
A proposed remote workspace or preview must respect its account, authorization,
private data, exposure, and lifetime boundaries; an assessment is not permission
to provision or publish it.

## Ability to serve users

Can operators diagnose failures and recover, and can they tell whether promised
journeys actually happen? Uptime and error reporting do not prove product success.
For a session game, relevant evidence might be rooms forming, play starting, and
sessions completing. Prefer existing records or first-party events to another
platform. Keep player content and durable identifiers out of payloads unless the
product requires them. A private or local-only tool may need no product telemetry.
Recommend only the observation needed for a real product or operating decision.
