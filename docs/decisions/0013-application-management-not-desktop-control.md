# 0013: Application management is not desktop control

- **Status:** accepted
- **Date:** 2026-10-16
- **Primitives:** `omp-config`

## Context

Desktop isolation exists to keep engineers from capturing the operator's live
screen or hijacking their cursor and input. Treating it as a prohibition on all
host-side installation prevented authorized Cantrip activation. After #283,
installed-code paths can be writable without changing the display boundary;
existing namespaces can still retain earlier read-only mounts. Installed bytes
also do not establish which executable a running service has loaded.

## Decision

Allow authorized application installation, configuration and service activation
through existing native owners. Extend Workbench's fixed repository route with
Cantrip, not with caller commands, environment/source/destination overrides, a
second broker, a generic application manager or desktop/session-bus access.
Selected-asset rollback and application-specific lifecycle/recovery remain
different contracts; an explicit Cantrip install preserves its current startup
owner and runtime data and must prove readiness plus the running executable's
identity. Harness installation never implicitly installs Cantrip.

For existing-broker updates, the native Workbench installer stages an immutable
release and changes its managed executable link without restarting the service.
The merged Harness CLI installer, executed on the host by the already supported
`install-repository --repository harness` recipe, feature-detects the owned
managed broker's exact `refresh-service` help entry and invokes only that fixed
command. A fixed outside-cgroup worker uses a serial quiescent handoff, preserving
queued connections for the new executable. The initial legacy upgrade has no
such protocol and requires a coordinated exclusive host-install maintenance
window before staging; a capabilities reply is not an admission lock. Its
fallback restarts only the broker unit.
The [runbook](../../omp-config/README.md#authorized-application-management) records the
concrete bootstrap and explicit Cantrip install/readback commands.

## Consequences

The live-desktop boundary and active OMP/Pi/Hermes sessions remain intact.
Ordinary installs with no supported managed broker behave as before. Code
installation and service activation require separate evidence; on-disk version
output is insufficient. Cantrip's longer repository-install transport deadline
covers source admission/build/lifecycle work, not speech inference or a config
change. Revisit only if a named application's native owner cannot support its
authorized lifecycle through a fixed recipe; that is not permission to expose
arbitrary host execution or the operator's desktop.
