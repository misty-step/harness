Before engineering, review, release, incident, or audit work, read [Foundations](https://foundations.mistystep.io/).

Every authored PR body has a `Story: <ID>[, <ID>]` line with story IDs from SPEC.md or USER_STORIES.md. Use `Story: none` when no story applies. Machine-generated, generator-only release PRs are exempt.

## Verification

Nothing is verified until the repository's verification skill has driven the real user journey end to end on the real product, including signing in as the actual owner identity, with the evidence linked. Proving only the sender side, such as an email sent or a 200 response, is not proof. A repository without such a skill gets one, made with `create-verification-skill`, in the same change.

## Design

Use neutral, professional, standard product design: plain words, nothing clever, no themes. Follow Emil Kowalski's design-engineering skills (`emil-design-eng`). Don't use Mobbin.

## Agent ergonomics

What we build is maximally agent-ergonomic, per [Foundations](https://foundations.mistystep.io/) article 12. Leave the operator no manual steps; use computer use when direct automation falls short.
