# Contributing

Mistystack is an OMP method plugin. Start with [AGENTS.md](AGENTS.md), use
[DOMAIN.md](DOMAIN.md) terms, and name the affected [story](USER_STORIES.md).
Fleet machinery belongs in private `misty-step/workstation`.

Keep the smallest useful change. Follow the skill frontmatter convention in
DOMAIN.md, retain source notices, and migrate every caller when a fact moves.
Human instructions belong in [docs/guide/](docs/guide/); upstream reading belongs
in [docs/references.md](docs/references.md), not an installed skill pack.

Run `./scripts/bootstrap` once for repository secret-scanning hooks, then
`./scripts/check`. Changes to installation or loading also use the isolated
fresh-session proof in
[verify-mistystack](.agents/skills/verify-mistystack/SKILL.md). Keep generated
proof outside the checkout and put the checked revision, commands and observed
results on the PR.

Use a Conventional Commit title and include `Story:` IDs, the rigor tier and
reason, and diff size in the PR. Keep CHANGELOG.md generated; Landmark owns the
release path described in [docs/release-convention.md](docs/release-convention.md).
