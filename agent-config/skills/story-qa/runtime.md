# Verification runtime boundaries

Use repository-owned setup across development, CI, and approved workspaces.
Establish prerequisites, source/artifact identity, representative data, and
service readiness. Worktrees isolate source; containers package dependencies;
VMs provide a machine boundary. None neutralizes arbitrary code or attached
integration authority.

Account, inputs, spend, exposure, and lifetime come from the actual execution
configuration and authorization. A clone may retain tags, integrations,
scheduled jobs, and persistent state; verification environments should not
silently inherit production writes.

Separate tabs may share one user. Separate browser contexts may still share the
same server-side account. Give each journey the state and identity its claim
requires; preserve unrelated data and distinguish stopping services from a
destructive reset. Track owned processes, browsers, containers, and retained
previews with their teardown.

For initial remote exercise, co-locate browser and application. A preview on
another device has separate routing/authentication needs: API origins, real-time
connections, cookies, and dev-server origin restrictions must work there. A
private frontend URL proves none of them. Retain the product's pinned interaction
stack; hosted browsers add connectivity, retention, and lifecycle constraints,
not an oracle. `skill://engineering-operations/workstation.md` owns execution
resources; `skill://session-close` owns leases.
