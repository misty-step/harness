# agent-config

Harness-neutral primitives consumed by Pi and OMP; harness-specific routing stays
with its consumer. Both consumers call `./install` with their selections, and
shared guidance splices at `<!-- shared guidance: agent-config -->`.

Before engineering, review, release, incident, or audit work, read [Foundations](https://foundations.mistystep.io/).

Run `../scripts/check shared`, which covers both fresh-clone consumers.
`skills/typesafe-ai/` is an unmodified upstream copy; `README.md` records its pin.
