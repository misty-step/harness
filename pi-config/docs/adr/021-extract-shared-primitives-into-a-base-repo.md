# ADR-021: Extract shared primitives into a base repo; keep the harnesses thin

Accepted 2026-09-16.

`decide` was byte-identical in both harness
repos, `authenticated-commands` differed by one sentence, the `pass-env`
launcher had one source and two consumers, and the pokayoke and host-resource
guidance was maintained twice — while `analyze.ts` had already drifted from the
"shared verbatim" claim in ADR-005. The "share conventions, not files" posture
had quietly stopped being true.

So the harness-neutral primitives move to
`agent-config`: the 13 portable skill
packages, three guidance sections (`pokayoke`,
`communication-and-verification`, `host-resources`), and `bin/pass-env.ts`. Each
harness declares its selection through one deploy contract; `agent-config` owns
the deploy mechanism, so neither harness reimplements it. `./install` composes
`~/.pi/agent/AGENTS.md` from pi's intro plus the selected sections at a marker
line, and validates the whole selection before any write.

What stays here: everything pi-specific — settings, extensions, the launch hook,
and pi's guidance intro. What pi gains: the shared skills it
lacked (`pokayoke`, `capture`, `foundation`, `agent-ergonomics`,
`verification-infrastructure`, and the vendored externals) and the
communication-and-verification discipline. Alternatives rejected: a git
submodule (pinning is not yet needed; the sibling path fails closed and the base
is checked out anyway), and duplicating the deploy mechanism in each harness
(the duplication this ADR removes). Revisit: if a harness must build without the
sibling checkout, pin the base as a submodule.
