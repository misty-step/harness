---
name: research
description: "When investigating a question, gathering docs or API facts, or verifying unfamiliar APIs, errors, protocols, and dependencies before coding."
metadata:
  owner: phaedrus
  prevents: "Code depending on recalled rather than verified interfaces; inferred 90-day use on 2026-10-28: research 8 plus agents/research 7 session-family read-path hits."
  source: "Local Misty ~/.omp/agent/skills/research; mattpocock/skills@59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/research; installed agents/research resolves to the same Pocock research skill; Daybook projects/mistystack.md decision 16; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/why"
  sunset: "2026-11-27"
---

# Research

1. **Question.** Frame the implementation-critical question and identify the installed version, disputed behavior and decision it changes. Memory is not an interface contract. For why code is the way it is, read blame and the introducing change's trail and linked decisions through the [Entire forge procedure](../misty/entire.md); follow backing-forge links when researching historical work. Verify unfamiliar APIs before code depends on them. Done when the question has an answer that source or observation can distinguish from alternatives.

2. **Sources.** Start with the source that owns the fact: installed code or types, official docs, first-party APIs, standards, changelogs or original papers. Use secondary writing to locate primary evidence. Match consequential claims to the version in use; a current web page does not prove an older installed version. For a dependency choice, compare the standard library, a maintained package and owned code; check license, maintenance, transitive weight and compatibility. Done when each critical claim has direct evidence or an explicit gap.

3. **Legwork.** Delegate independent reading to subagents through your harness's subagent mechanism under the `agent-design` skill and the briefing contract in the `misty` skill. Give each a bounded question and ask for source links, relevant excerpts, versions, contradictions and unresolved claims. Continue work that does not depend on the answer; keep blocked decisions pending. Do a small direct lookup inline rather than creating a ceremonial handoff. Done when the returned evidence answers the question, not merely a summary that sounds plausible.

4. **Resolve.** Read the primary material behind consequential findings. Reconcile conflicting sources against installed behavior or a focused probe when necessary. Separate what a source states from what you observed. Choose an approach that does not rely on an unresolved critical claim; otherwise name that precise missing prerequisite and finish the unblocked research. Done when the implementation can use the answer without guessing at a contract.

5. **Return.** Lead with the answer and decision it supports. Cite direct, clickable source links beside the claims, with version limits, rejected alternatives and open gaps. Apply the `misty` skill's claim rule: **measured** for observed source or probe results, **inferred** for a conclusion drawn from evidence, and **guess** for an untested hypothesis. Reading documentation proves what it says, not that the live path behaves that way. Store durable findings only when requested or needed as a maintained project record, in its existing home; return temporary legwork in the task result. Done when every implementation-critical claim is source-verified or explicitly excluded from the design.
