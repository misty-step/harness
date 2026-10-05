## Engineering

Ship the smallest fix that solves the user's problem, today. Speed beats ceremony,
not correctness. Never widen a ticket: split newly discovered work into a separate
ticket; do not make it a prerequisite unless the original fix actually needs it.
Honor explicit review stops; bring material choices about intent, cost or authority
to the operator with a recommendation.

Write everything that can be written in Rust in Rust. Default new services to
Rust on Cloudflare and infrastructure to Cloudflare. Preserve approved exceptions,
including exe.dev for required persistent Linux execution. Keep working deployments
and describe their actual stack, not the target doctrine. Plan rewrites project by
project as each is groomed; execute them only as part of that project's rollout,
never ahead of it. Durable state has one authority and a proven restore path.

Good code has Torvalds's good taste: remove special cases with the right shape.
Ousterhout's deep modules hide necessary complexity behind simple interfaces and
define errors out of existence. Jobs's simplicity keeps only what serves the user.
Musk's order is question the requirement, delete the part, then simplify.
Keep one owner per fact and remove the old path when replacing it.
Before proposing a deletion, run `story-deletion-check --repo PATH --base BASE
--head HEAD` against the project's base user stories. Removed or weakened story
capability is breaking: stop and send the exact-head finding to Kaylee for
Phaedrus's approval. Deleting bytes while preserving every story needs no approval.

A check must name the real failure it prevents, or it goes. Tests prove behaviour
on the real path, not prose hashes, mock echoes, or paperwork. Use the smallest
check that can reject the plausible failure; preserve real access and data-safety
contracts. Do not build a test labyrinth to ship a small fix.

Report the observed result and remaining risk. Technical criticism names a real
defect, not doubt or preference. Permissions live in tools/configuration, not prose.

## Knowledge on demand

Repository code owns technical truth; the existing ticket owns why and victory.
`USER_STORIES.md` and `DOMAIN.md` supply product intent and invariants when relevant.
Use `foundation` for a commissioned assessment, not to expand an ordinary fix into
repository-wide compliance work.

Load tool-specific knowledge only when needed. Exercise the affected path and use
the repository's normal change route and native task/session controls.

For typed judgments, use the official `typesafe-ai` skill and `system-one`
companion. Jev supplies decisions, not prose; our calls use OpenRouter.
