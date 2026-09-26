# Authoring the foundations

Changing the foundations touches three owners, and they change together:
- [`constitution.md`](constitution.md) states the principles;
- the [catalog](foundation-standard-v1.json) holds the normative obligations, with their applicability and evidence;
- the ADRs record why.

## Writing the constitution

- Agents read the constitution while working. Keep it short and put nothing
  in it about how to write or edit foundations.
- Each principle is one plain sentence. At most two short sentences follow:
  what it means in practice and how it is checked. No ids, file paths or
  jargon in the principle itself.
- Source principles from Phaedrus's own words first: his journal, dictated
  notes and direct decisions. Accepted ADRs come next, then the catalog.
  Where they differ, the constitution follows his philosophy and the gap goes
  under open questions below.
- Adding or widening an obligation, or removing an escape, needs Phaedrus's
  approval. Tightening a check within an existing obligation, editing
  rationale, or retiring a check nobody acts on goes through the harness's
  normal review (ADR-006). Tightening never removes an approved escape.

## Open questions

These are gaps between the philosophy in the constitution and what the catalog
requires or allows today:

- The review asks every change about taste, deep modules, separation, deletion
  and small apps, but no obligation requires them.
- The size target, under 100,000 lines and ideally 50,000, is not measured.
- The June notes want 80 to 100 percent automated coverage with enforced
  thresholds, plus property and mutation tests. The catalog asks only for
  checks that catch named failures.
- The June notes default to Rust for nearly everything. The August journal
  lists Go, Rust or TypeScript. The catalog names no language.
- Infrastructure managed only through code, a command line or an API, with no
  sign-ups or dashboards, is not an obligation. The catalog asks only for a
  setup script that needs no credentials.
- The June notes prefer tools that live in git over tools that live in GitHub.
  Today's checks depend on GitHub.
- The journal leans to PostHog for product analytics. The catalog defaults to
  the product's existing database.
- Diverse reviewers across models and perspectives are a principle. The
  independent-review obligation asks only for a reviewer other than the
  author.
- The journal wants QA environments per branch on demand. The catalog asks
  only for a fresh workspace setup.
- The journal wants a marketing site and user and contributor docs. The
  catalog asks for a public page only for public products.
- AI cost limits, traces and evals appear in the journal. No obligation covers
  them.
