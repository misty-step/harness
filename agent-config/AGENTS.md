# agent-config

Edit shared harness primitives here. `./install` is the single deploy contract;
`pi-config` and `omp-config` invoke it with their selection and keep only
harness-specific configuration.

## Ownership boundary

This repo owns a primitive only if it is harness-neutral and either duplicated
across harnesses or consumed by more than one. Harness policy — model routing,
trackers, settings, extensions, themes, vehicle pointers — stays in the harness
repo. When in doubt, leave it in the harness.

## Guidance sections

`guidance/*.md` are complete `##` sections. Each harness guidance file carries
the `<!-- shared guidance: agent-config -->` marker; `./install` splices the
selected sections at that line and fails closed when the marker is absent. Keep
section text harness-neutral: a pointer such as `skill://using-exe-dev` belongs
in the harness file, not in a shared section.

## Verification

- `../scripts/verify shared` — syntax, shared unit tests, and both consumers'
  fresh-clone installer checks.
- Compose a harness guidance file into a temporary directory and diff it against
  the live deployed copy before trusting a shared-guidance change.
