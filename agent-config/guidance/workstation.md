## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.

## Routing until Upkeep

For every dispatch, use the authoritative [ship-loop routing and rigor table](skill://ship-loop/roles.md#rigor) for review shape, models and effort.
As of 2026-10-20, all work runs on Claude, with each role's model in that table: Opus 5.5 by default, Sonnet 5.5 for light QA and Haiku 5.5 for trivial work. Every Codex account is out (`codex` and `codex-mistystep` until 2026-10-27; `codex-r90` has no credits). Use Sol only once `upkeep` shows a Codex instance with room. `claude-hello` is reserved for Home. No Fable or Astra.
Reserve fast mode for bottlenecks and top priorities.
Pass the role's effort explicitly to `delegate_task`: Claude uses `target.options: [{"id":"effort","value":"<low|medium|high|xhigh>"}]`; Sol uses `target.options: [{"id":"reasoningEffort","value":"<low|medium|high|xhigh>"}]`.
For fast mode, add `{"id":"fastMode","value":true}` to Claude's `target.options`, or `{"id":"serviceTier","value":"priority"}` to Sol's.
Check `upkeep anthropic` and `orchestrator_capabilities` before trusting any provider or model list.
