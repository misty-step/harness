# agent-config

Harness-neutral primitives consumed by Pi, OMP and Claude Code; harness-specific
routing stays with its consumer. Each consumer calls `./install` with its
selection, and shared guidance splices at `<!-- shared guidance: agent-config -->`.

Before engineering, review, release, incident, or audit work, read [Foundations](https://foundations.mistystep.io/).

Run `../scripts/check shared`, which covers every fresh-clone consumer.
`skills/typesafe-ai/` is an unmodified upstream copy; `README.md` records its pin.
