---
name: engineering-operations
description: Use for exe.dev VM approval, desktop-guard and host limits, or operator review pages; none of them is product proof.
---

# Engineering operations

Workstation traps beyond the global workstation facts:
- exe.dev (`remote-execution`): standing approval covers one project VM in the
  existing $40 plan; other VMs need approval. Never delete a standing or foreign VM.
- `desktop-guard run -- command` bounds the client, not its daemon's containers.
  Do not restart running sessions or change host limits during routine work.
- The OMP resource cage wraps the stable `omp` entrypoint, not the retained native
  ELF; staging files does not activate it (see the
  [memory runbook](https://github.com/misty-step/harness/blob/master/docs/desktop-memory-guard.md)).
- Operator review pages: [review-page.md](review-page.md).
- Credentials: `authenticated-commands`.
