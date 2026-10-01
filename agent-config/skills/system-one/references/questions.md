# Question design

One snap judgment per question, independently answerable from the supplied state.
Complete meaning belongs in `instructions`; question IDs are not sent to the model.

| Need | Primitive | Returns |
| --- | --- | --- |
| Select a declared option | Choice | `choice`, `probabilities`, `confidence` |
| Degree on ordered levels | Score | `score`, `legend`, `probabilities`, `confidence` |
| Probability a condition holds | Noul | `noul` in `[0, 1]`, no confidence |

Choice needs an escape (`none_of_these`, `other`, `unrelated`); otherwise omitted
answers force probability onto the nearest declared option. Keep candidates
small and valid. Score levels should describe concrete situations. Noul's `true`
names the target/violation; use separate Noul questions for independent labels,
not one mutually exclusive Choice.

Align criteria to actual state, with named JSON fields where useful. Avoid
double negatives and theory-of-mind assumptions. Strings suffice for simple
questions; structured examples can clarify contrasts and exclusions.

Batch every independent question over the same state, including speculative
branches with their premise explicit. Questions cannot see one another's
answers. A second request earns its place only when an earlier answer is needed
to fetch evidence or construct later options. Ignore unused speculative answers.
Split independent factors; combine them with code weights.

Choice/Score confidence describes their distribution. Flat means uncertainty;
Noul near 0.5 means similar yes/no probability, not medium intensity. Thresholds
depend on the cost of being wrong and evaluated cases, not cookbook numbers.

Use current live-doc limits. Chunk multi-file state by file/hunk rather than
truncating the tail. Keep `.env`, keys, and private-key files out of state.
