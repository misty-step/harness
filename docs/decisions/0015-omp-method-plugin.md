# 0015: OMP method plugin, separate workstation machinery

Status: accepted, 2026-10-28. Part of
[#533](https://github.com/misty-step/mistystack/issues/533).

Mistystack is Misty Step's engineering method, not a fleet installer. The earlier
multi-client workspace mixed procedures, host machinery and several copies of
operating guidance. Moving a skill also broke installer inventories. One method
plugin and one machinery owner make those boundaries explicit.

## Decisions

- **Q2 — OMP only.** Ship native `.omp-plugin/` manifests, an always-on core,
  the `misty` mode, principle leaves, playbooks, skills and role-backed task
  agents. OMP owns discovery, plugin installation and dispatch. Remove the pi,
  Claude Code and Codex adapters rather than keep compatibility shims.
- **Q7 — references, not packs.** Keep selected upstream reading in
  `docs/references.md`; install only the method we maintain. Derived material
  records its source and required notices in skill metadata and ATTRIBUTION.md.
- **Q14 — machinery has a private home.** Move OMP configuration and extensions,
  launchers, host installation, credentials, audio, session backup and Kaylee to
  private `misty-step/workstation`, preserving their history and consumer
  stories. The workstation plugin consumes mistystack; it owns no second copy
  of the method. Setup writes model assignments through OMP config.
- **Q15 — retire the Foundations site.** Its audit rubric has one home in
  `skills/foundation/checklist.md`; human guidance lives in `docs/guide/`.
  The former site becomes a redirect to those homes. FOUNDATIONS.md remains a
  pointer, and `docs/release-convention.md` retains its path for external links.
  The redirect deployment is separate from this source cutover.

## Rejected alternatives

- **Keep multi-client adapters:** their selection and installation contracts
  add maintenance without advancing the OMP-only method.
- **Bundle upstream skill packs:** a second installed authority expands context
  and duplicates rules; references preserve useful reading without ownership
  ambiguity.
- **Keep machinery in the public method repository:** host and credential
  lifecycle changes would keep coupling method edits to installer tests.
- **Maintain the Foundations site beside the checklist:** two writable copies
  would drift. A redirect preserves discovery while the checklist stays the
  authority.

Historical decisions, postmortems, migration records, releases and their old
paths remain evidence of what happened, not instructions for the current layout.
