# Prose editing

## Operator prose

Apply Simplified Technical English as an editing discipline, not a claim of certified ASD-STE100 compliance. Use a technical term when it is more exact than an everyday substitute.

- Put the actor and action in the sentence. Prefer "The compiler rejects the rename" to "The rename is validated".
- Give each term one meaning. Repeat the canonical noun instead of cycling through synonyms.
- Put a warning or condition before the step it governs. Keep "only" beside the word it limits.
- Split a sentence when it carries multiple instructions or makes the reader backtrack. About 20 words for an instruction and 25 for other sentences are useful inspection points, not hard limits.
- Keep articles, verbs and connective words that remove ambiguity. Replace a noun stack with the relationship between its nouns.
- Make pronouns point to one noun. Name the noun again when needed.
- Write a sequence as numbered actions with visible results. Give exceptions after the common case.

## Cut the tells

Preserve the claim while removing the pattern. Ordinary technical uses of a word are not defects.

| Pattern | Edit |
| --- | --- |
| Vague attribution: "experts believe" | Name and link the source, or remove the claim. |
| Unsupported implication: "ensuring reliability" | State the mechanism or observed result. |
| Inflated verbs: "serves as", "leverages" | Use "is" or "uses" when that is the meaning. |
| Generic praise: "robust", "seamless", "significantly improves" | Name the behavior or measured difference. |
| Stock contrast: "not just X, but Y" | State Y directly when the contrast adds nothing. |
| Forced triples, false ranges and synonym cycling | Use the actual number of points and one name per concept. |
| Abstract metaphor: "north star", "flywheel", "substrate" | Name the actual goal, feedback mechanism or base. Keep the exact term when the field requires it. |
| Feelings in place of behavior: "SQL you can read" | State what the interface returns or lets the user do. |
| Sycophancy, chatbot preambles and generic conclusions | Start with the answer and end with the consequence. |
| Filler and stacked hedges | Delete filler; retain the actual uncertainty. |
| Decorative emphasis and headings that repeat their text | Use sentence-case headings and emphasis that helps lookup. |
| Over-compression: fragments, symbol chains and missing articles | Restore a grammatical sentence. |

Punctuation is not evidence of poor prose. Keep a dash, colon, parenthesis or quotation mark when it makes the sentence clearer.

## Document modes

Choose the reader's job before the structure. Split and link material that serves a different job.

- **Tutorial:** learning by doing. Name what the learner builds; give visible results early. Move background explanation behind links.
- **How-to:** a competent reader's task. Use direct steps, conditions and expected results; link background and reference.
- **Reference:** lookup. Mirror the interface's structure and state options, limits and errors. Generate mechanical facts from their owner where practical.
- **Explanation:** a bounded why. Explain causes, alternatives and tradeoffs; distinguish the recommendation from evidence.

Use exact symbols, flags and file names in code font. Link text names the destination rather than saying "click here". Prefer a useful sentence to a diagram; use a diagram only when relationships are clearer in it. Change sentence length for clarity, not a manufactured rhythm.
