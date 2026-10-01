---
name: agent-design
description: Use only when building or changing an agent's prompts, skills, tools, or context loading.
---

# Agent design

Give the model a clear job, useful tools, and room for judgment.

Keep always-loaded guidance to positive philosophy and non-obvious local facts.
[Agent Skills](https://agentskills.io/specification) loads name/description first,
instructions on activation, then referenced resources on demand. Frontmatter
names the outcome and concrete trigger; delete overlapping skills instead of
adding another instruction layer.

Keep stable instructions/tools at the prompt prefix; append volatile task state
and retrieved evidence. Tool/schema reordering and early timestamps can break
reuse. Inspect provider usage, not guessed savings:
[Claude caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching).
Read current docs before changing provider-specific breakpoints or retention.

Prefer tools and canonical facts to bulky injected inventories or copied manuals.
Use real first turns for discovery and initial choices; prove complete outcomes
on the actual owner/consumer path.

Models author messages from facts and intent. Code owns deterministic mechanics,
not canned human prose. Phaedrus: “our agents should never be writing templates...
we should be letting them write.”

Role, responsibility, ambition, and voice belong in language. Permissions belong
in structural tool scope, configuration, and credentials. Phaedrus: “absolutely
not use natural language to communicate permissions.” Prove the actual boundary;
a prompt saying an agent cannot act is not a control.

The [shared engineering principles](https://github.com/misty-step/harness/blob/master/agent-config/guidance/engineering.md)
set this harness's philosophy; provider docs own API facts.
