## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.

## Routing until Upkeep

For every dispatch, use the authoritative [ship-loop routing and rigor table](skill://ship-loop/roles.md#rigor), including its coordinator, effort and Fable/Astra rules.
Reserve fast mode for bottlenecks and top priorities.
Pass the role's effort explicitly to `delegate_task`: Sol uses `target.options: [{"id":"reasoningEffort","value":"<low|medium|high|xhigh>"}]`; Claude uses `target.options: [{"id":"effort","value":"<low|medium|high|xhigh>"}]`.
For fast mode, add `{"id":"serviceTier","value":"priority"}` to `target.options`.
The Codex instances with credits are `codex-mistystep` and `codex`. Check `orchestrator_capabilities` before trusting any provider or model list.
