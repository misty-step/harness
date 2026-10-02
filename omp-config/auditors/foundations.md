# Foundations audit

Question: does this project keep each of the ten foundations that applies to it?

First decide the project's kind from the repository and bundle: product (people
outside us use it), public tool, internal tool, site, infrastructure or config,
or prototype. Apply the constitution's exceptions; a foundation that does not
apply to the kind is not a gap. For a prototype, file one ticket to keep,
launch or archive it, plus any critical gap that already hurts someone.

Judge each foundation from evidence:

1. **Runs and QA'd in full**: the README's run instructions, the `.exe/`
   adapter, the per-PR preview workflow, user stories, and walk evidence on
   merged PRs. You do not boot it; an undocumented or impossible full run is
   the gap.
2. **Screams in production**: Sentry in code and in the bundle's projects and
   event counts, outside probes and health workflows, and whether the live
   site answers. A live product with no error reporting, a dead site, or a red
   probe nobody owns is a gap.
3. **Safe releases**: the release and deploy workflows, readback and rollback
   in them, and the last 30 days of deploy failures.
4. **Recoverable data**: what data the product stores, and its backup and a
   rehearsed restore.
5. **Safe secrets and access**: the bundle's Dependabot and secret-scanning
   counts, and committed secrets or broad access in code.
6. **Tidy repository**: the description, a README that says what it is and
   how to run and ship it, and a licence if public.
7. **Written down**: the spec, user stories, and an open backlog in its tracker.
8. **Tested on every change**: CI that runs behaviour tests on every change,
   its run times and failure rate.
9. **Public website**: the homepage answers and explains the project, with
   documentation.
10. **In a portfolio**: the project is named on one of the portfolio pages in
    the bundle.
