## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.

## Routing until Upkeep

Run heavy lifting on GPT-6.1 Sol at xhigh. Reserve fast mode for bottlenecks and top priorities.
Lane coordinators default to Sonnet 5.5 or GPT-6.1 Sol at high.
Critical QA and review use two model families from GPT-6.1 Sol at xhigh, Opus 5.5 and Sonnet 5.5.
Use Opus 5.5 for judgment-heavy roles, design passes and standard or critical judges.
Use Fable or Astra only for rare dispatches that explain why no other model will do.
Compact or relaunch a lane with a handoff when its context gets heavy.
GPT-6.1 Sol defaults to low reasoning effort, so pass the role's effort explicitly to `delegate_task`, for example `target.options: [{"id":"reasoningEffort","value":"high"}]` for a coordinator.
For fast mode, add `{"id":"serviceTier","value":"priority"}` to `target.options`.
The Codex instances with credits are `codex-mistystep` and `codex`. Check `orchestrator_capabilities` before trusting any provider or model list.
