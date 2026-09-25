# ADR-016: Provide a dedicated 'decide' skill for dense, ASD-STE100 executive decision briefs

Accepted 2026-09-15.

When an operator asks an agent to "help me make a high
quality decision here," the agent frequently defaults to conversational filler,
false balance, or open-ended clarifying questions. For frontier reasoning models
(GPT-6 Astra, Claude Fable 5), modern prompt engineering research establishes
that models reason best when given clear outcomes, permission to infer intent
and inspect local context autonomously, and tight stylistic constraints. We
provide `skills/decide/SKILL.md` with `disable-model-invocation: true`:

- **ASD-STE100 controlled language.** Sentences are limited to 20 words for
  instructions and 25 words for descriptions. Active voice and direct verbs are
  mandatory. Conversational preamble, apologies, and AI clichés ("delve",
  "foster", "leverage", "crucial", "seamless") are prohibited.
- **Autonomous context gathering.** The model infers intent and inspects primary
  artifacts (git diffs, error logs, interface boundaries, ADRs) before writing,
  rather than stalling with clarifying questions.
- **Structured decision memo.** Outputs context, forcing function, non-negotiable
  invariants, candidate paths, a Markdown tradeoff matrix (reversibility, blast
  radius, effort, operational cost, primary risk), a justified stance with
  decision boundary conditions, and the single next action.
- **On-demand invocation only.** Hidden from ambient context via
  `disable-model-invocation: true` to avoid token bloat during normal turns;
  invoked explicitly via `/skill:decide [optional topic]`.
- **Sister repo parity.** Authored identically across `pi-config` and `omp-config`.
