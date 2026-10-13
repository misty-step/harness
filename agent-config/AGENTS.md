# agent-config

Harness-neutral primitives consumed by Pi and OMP; harness-specific routing stays
with its consumer. Both consumers call `./install` with their selections, and
shared guidance splices at `<!-- shared guidance: agent-config -->`.

Do the stated job in the fewest clear lines; delete and reuse, not needless layers,
frameworks, flags, guards, holds or config. Compose simple, focused UNIX programs
from small modules and packages. Past about 10000 LOC, report and seriously consider
separate services; guidance, not a gate. Make end-user verification easy and lean:
show it working; more checking instead of shipping is failure. Keep few good tests
of consumer contracts. Review for the job, a simpler version and test value.

Run `../scripts/check shared`, which covers both fresh-clone consumers.
`skills/typesafe-ai/` is an unmodified upstream copy; `README.md` records its pin.
