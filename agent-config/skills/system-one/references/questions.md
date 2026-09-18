# Question design

Write questions as snap judgments a knowledgeable person can make in a second
given the right state. "Does this message convey urgency?" is a question.
"Analyze this and decide the best course of action" is not — split it.

## Primitive

| Need | Type | Returns |
| --- | --- | --- |
| One of a defined set | Choice | `choice`, `probabilities`, `confidence` |
| Degree on ordered levels | Score | `score`, `legend`, `probabilities`, `confidence` |
| Whether a condition holds | Noul | `noul` in `[0, 1]` — no confidence field |

Question IDs are for code. They are not sent to the model. Put the whole
question in `instructions`.

## Instructions

- One narrow, coherent judgment per question.
- Phrase Noul so `true` is the target or violation.
- Align wording to the state shape. Do not ask about "diff hunks" when state is a transcript.
- No double negatives. Jev has no theory of mind.
- Prefer named JSON state. Reference nested fields with backticked paths such as `ticket.messages[0].text`.
- Strings are enough for simple questions. Use structured objects when contrasts, exclusions, or examples clarify criteria.

## Criteria

- **Choice:** map of option → rubric. Include an escape (`none_of_these`, `other`, `unrelated`). Probability mass is forced onto the declared set; an omitted true answer will land on the closest option.
- **Score:** ordered levels that stand alone as concrete situations, not vague adjectives.
- **Noul:** optional `true` / `false` clarifications. Use one Noul per label when several may apply; do not pack independent flags into one Choice.

Keep the option set small. A 20-way Choice overflows. Code should generate 3–8 valid candidates, then Jev selects.

## Parallel questions

Ask every independent question over the same state in one request, including
speculative ones whose answers only matter on some branches. They cannot see
one another's answers. State each speculative premise in that question.

A second request is warranted only when the first answer is required to fetch
evidence, construct new state, or determine the next options. If the later
questions could have been asked against the original state, ask them together
and ignore unused answers in code.

Split a multi-factor judgment into one question per factor. Combine with
weights in code. When priorities change, change the weights, not the prompt.

## Confidence and thresholds

Confidence is a statistic on the Choice/Score distribution, not a license to
act and not overall workflow correctness. A flat distribution means "I don't
know" or "several options fit." A Noul near 0.5 is similar probability for yes
and no, not medium intensity.

Put thresholds in code next to the questions. Scale them with the cost of
being wrong. Cookbook and demo numbers are examples to evaluate, not defaults.

## State budget

Cap a single call. Prefer the live docs' current limit over any number in this
file. For multi-file diffs, chunk by file or hunk, not by truncating the tail.
Do not send `.env`, keys, or private-key files as state.
