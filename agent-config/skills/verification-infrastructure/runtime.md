# Runtime boundaries

Use existing repository-owned setup across local development, CI, and an approved
remote workspace where practical. Establish prerequisites, source and artifact
identity, representative data, service readiness, and external-service boundaries.
A missing real backend is a missing prerequisite, not a reason to substitute fake
product behavior or a historical readiness receipt.

## Isolation and authority

Worktrees isolate source, containers package dependencies and services, and VMs
provide a machine boundary. None grants authority or makes arbitrary candidate
code safe. Consult the relevant infrastructure skill and current vendor guidance
before operating it, including `skill://using-exe-dev` for exe.dev. Product-specific
behavior belongs in the product, not vendored skills.

Before provisioning, transfer, sharing, or recurring execution, resolve the
account, inputs, capabilities, spend, exposure, and lifetime within the actual
authorization. Keep production write authority out of ordinary verification.
Attached integrations and workspace clones can still carry live API authority.
Clones may carry tags, auto-attached integrations, scheduled jobs, and persistent
state. Those need deliberate ownership, not an assumption of isolation.

Give runs the application state and identities their claims require. Separate
tabs may share a user; separate browser contexts may still share a server-side
account. Preserve unrelated resources. Establish ownership and teardown for
processes, browsers, containers, data, and retained previews, distinguishing
stopping services from destructive reset.

## Remote exercise and human preview

Prefer browser/application co-location for a first remote exercise. A preview
for another device has a separate routing and authentication contract: API
origins, real-time connections, cookies, and dev-server origin restrictions must
work from that device. A private frontend URL alone proves none of this. Do not
publish a service or weaken guards merely to obtain proof.

Use native harness interaction tools where appropriate and preserve repository-
pinned browser workflows. Avoid overlapping stacks without a demonstrated need.
Hosted browsers introduce connectivity, retention, and lifecycle
requirements; they are not a verification oracle.
