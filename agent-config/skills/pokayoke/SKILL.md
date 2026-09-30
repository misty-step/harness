---
name: pokayoke
description: Close an error class structurally after a defect, incident, or near-miss.
disable-model-invocation: true
argument-hint: "[error class or incident]"
---

# Pokayoke

Remove the affordance that permits the whole class of error, not just its latest
instance. Prefer shape/type, single ownership, removal of a dangerous operation,
or a check that rejects the mistake before it completes. A warning or reminder
does not make the error impossible.

Deliver the error class, simplest mechanism, evidence that the original mistake
path is closed, and residual failures still possible. Stay within the
commissioned repair; error-proofing is not a second framework or portfolio rollout.

Use the canonical [postmortem-template.md](postmortem-template.md) for an incident.
Real postmortems live in the owning repository's `docs/postmortems/`, not copied
templates (ADR-004). Link the structural fix and meaningful regression evidence.
