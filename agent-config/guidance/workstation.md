## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.

## Routing until Upkeep

Run heavy lifting on GPT-6.1 Sol at xhigh. Reserve fast mode for bottlenecks and top priorities.
GPT-6.1 Sol defaults to low reasoning effort, so pass `target.options: [{"id":"reasoningEffort","value":"xhigh"}]` to `delegate_task`.
For fast mode, add `{"id":"serviceTier","value":"priority"}` to `target.options`.
The Codex instances with credits are `codex-mistystep` and `codex`. Check `orchestrator_capabilities` before trusting any provider or model list.
