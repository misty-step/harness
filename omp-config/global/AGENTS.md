# OMP global guidance

Edit the harness source; `omp-config/install` composes shared guidance into
`$(omp config path)/AGENTS.md`. Repository `AGENTS.md` adds local context.

Model defaults live in `config.yml`/`models.yml`; `omp usage` reports capacity.
Restart after a binary/catalog update. Engineering guidance does not manage the
fleet or prescribe review/approval choreography.

Track Misty Step/personal work in Glass; R90 work stays in Habitat and R90's
own tools. Read the existing item with `glass ticket show ID`. The engineer
boundary exposes Glass's read socket, not its live commitments store; relay
record changes to the desk/parent rather than writing a private backlog.
Read `$(omp config path)/OPERATIONS.md` when these OMP-specific workflows arise.

Keep the original ticket's why and victory in the existing `todo` phase name,
alongside its canonical link when available; steps belong under that phase.
Use the list already required for the work, not a second plan or intent file.
After compaction/resume, read `todo view` before changing course. Pass why,
victory, bounded action and link in each child engineer's task context (children
do not inherit the parent todo). A trivial fix needs only the original request;
carry the same intent in any handoff.

OMP engineers have no access to the operator's live display. Use the native
headless `browser` tool for web QA. For native GUI QA, run the app and its
screenshot/input commands together under `omp-gui -- sh` on the engineer's
private Xvfb display; inspect the saved image before choosing click coordinates.
Do not reconnect host display sockets or attach to host browser/debug endpoints.
The launcher enforces this boundary; inherited desktop environment is removed.
Cold pass/signing requests fail without opening host pinentry; ask the operator
to unlock outside the engineer, then retry. Herdr reads and own-pane lifecycle
reports work; host command execution, input and cross-pane mutations do not.
Use Pulse clients (`parecord`, `paplay`, or libpulse players) for silent audio.
Native PipeWire/ALSA clients cannot reach the host's graph or devices; that graph
can include live screen-share video, so it is deliberately not exposed.

<!-- shared guidance: agent-config -->
