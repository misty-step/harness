---
name: writing
description: "When writing or editing prose to people: operator replies, reports, documentation, commit titles, and trail bodies."
metadata:
  owner: phaedrus
  prevents: "Q10 (Daybook decision 16): vague, mannered or ungrounded operator prose; inferred 90-day use on 2026-10-28: unslop 1, technical-writing 1, pr 1 session family each."
  source: "Daybook projects/mistystack.md decision 16; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/{unslop,technical-writing}; mattpocock/skills@59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/pr; humanlayer/skills@653b6411c1f70c275a18e37673b042ff99f67ceb/plugins/show-me/skills/show-me; Foundations way-of-working Claim precisely and Review; cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/{no-comments,bro}"
  sunset: "2026-11-27"
---

# Writing

1. Lead with what changes for the consumer, then the maintainer. Use the field's exact terms and `DOMAIN.md` names. State the conclusion, evidence and required decision; cut chronology that changes none of them.
2. Write the specification directly: actor, action, condition and observable result. State the target behavior positively. Pair a necessary hard guardrail with what to do instead. Code comments state only a non-obvious why. Let the text carry its register rather than adding persona or tone instructions.
3. For agent-to-operator prose, apply Simplified Technical English: one instruction per sentence, one meaning per term, active verbs, conditions before steps and complete sentences. Keep articles and verbs; terse is not telegraphic. Read [prose.md](prose.md) for the editing pass and document-mode guidance.
4. Follow the core's claim rule and the `misty` skill's report-link and delivery-state distinctions.
5. For a commit or trail body, read [publications.md](publications.md). Use a Conventional Commit title. A trail states why, what changed, `Story:`, `Rigor:`, concrete risk and observed verification; link long evidence instead of pasting logs. Follow the [Entire forge procedure](../misty/entire.md) for publication and backing-forge exceptions.

When asked to restate plainly, repeat the last message without jargon, as one person to another.

Done when the reader can identify what changed for them, what the evidence supports, and any decision or blocker without decoding jargon or opening a transcript. Preserve uncertainty and meaning through the edit. Use punctuation for clarity; punctuation bans are not part of this skill.
