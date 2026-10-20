Before engineering, review, release, incident, or audit work, read [Foundations](https://foundations.mistystep.io/).

Every authored PR body has a `Story: <ID>[, <ID>]` line with story IDs from SPEC.md or USER_STORIES.md. Use `Story: none` when no story applies. Machine-generated, generator-only release PRs are exempt.

## Verification

Nothing is verified until the repository's verification skill has driven the real user journey end to end on the real product, with the evidence linked. When the product has sign-in, that journey signs in as the actual owner identity; proving only the sender side, such as an email sent or a 200 response, is not proof. For a CLI, library, configuration or documents, the journey is what its user does (install, run, read the result), and owner sign-in is n/a. An internal change with no user-observable behavior needs proof that it composes instead. A repository without a verification skill gets one, made with `create-verification-skill` at `.agents/skills/verify-<app>/` with a `.claude/skills/verify-<app>` symlink: add it in the change, or stack the change on the open PR that adds it.

## Agent ergonomics

What we build is maximally agent-ergonomic, per [Foundations](https://foundations.mistystep.io/) article 12. Leave the operator no manual steps; use computer use when direct automation falls short.
