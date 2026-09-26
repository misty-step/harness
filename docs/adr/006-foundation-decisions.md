# ADR-006: Foundations constitution, dated gaps, and agent authority

Status: Accepted 2026-09-26 (MIS-150). The operator approved six decisions from
the foundations research brief, relayed by Kaylee:
"carry out his six decisions from your brief as approved". Evidence:
`~/.cache/research-briefs/2026-09-26/foundations-system.md`, which covers the
Pocock study, the fleet survey, the practitioner survey and the Jev probes.

This record amends ADR-003 (review triggers) and ADR-004 (the home of a
repository's judgement rules). It adds three obligations to the Foundation
Standard. The catalog and checker change that implements them is catalog
1.5.0, owned by the catalog owner and citing this record.

## Context

- Six repositories adopted on 2026-09-25, all pinning catalog 1.1.0. 77 of
  their 84 dispositions are `pending`.
- The checker lists `pending` as needs-evidence and never fails it, except for
  ADR-005's three operational obligations.
- For the obligations outside ADR-005, the content of a `satisfied` receipt is
  not verified: any non-empty text passes. `not_applicable` passes with a
  `decision` string, and `exception` with a `decision` and an `expires` date.
  The catalog requires an `approval_ref` and a `foundation-approval/1` record
  for both. ADR-005's three obligations already reject `exception` (and
  `not_applicable` for an application), and their `satisfied` claims are
  checked structurally. Catalog 1.5.0 keeps those checks.
- Written rules do not move agents; failing checks do (ADR-003).
- Agents were never told the foundations exist: global guidance did not
  mention them, and the `foundation` skill is invoked by the user only.
- Unenforced repository rules had two homes under ADR-004: review priorities
  in `AGENTS.md`, and invariants in `DOMAIN.md`.

## Decisions

1. **The foundations.** [`constitution.md`](../../agent-config/skills/foundation/constitution.md)
   is the canonical short statement of what every project must be, keep, and
   keep improving. The catalog remains the only normative list of obligations,
   with their evidence and applicability. Three obligations join it:
   - **Independent review.** Every change is reviewed by someone other than its
     author, against the constitution, the repository's invariants ledger and
     the story it serves.
   - **Security baseline.** The gate scans for secrets, a bot keeps
     dependencies current and its safe updates merge on green, and
     applications test their authorization boundaries.
   - **Story citation.** A pull request that changes mapped source cites the
     affected story ids, computed with `foundation-check affected`.

   The catalog owner assigns the obligation ids and evidence fields in 1.5.0.
2. **A repository's judgement rules live in the `DOMAIN.md` invariants
   ledger.** These are the invariants and review rules for what must hold in
   its product, code and data. `AGENTS.md` keeps operating instructions for
   agents (local overrides of global defaults, permissions and routing) and
   routes to the ledger; it no longer holds "review priorities" or "invariants
   that code does not enforce". The ledger's grammar is in ADR-004's
   amendment. A change to the ledger needs the designated reviewer, like first
   stories. Reviewers read the ledger at the base revision.
3. **Pending means a dated gap, and done means verified evidence.**
   - Every applicable `pending` obligation is a baseline gap with an owner and
     an expiry at most 30 days out, like the `ops:` gaps. Extensions still
     need the designated reviewer (ADR-003).
   - `satisfied` needs a receipt the checker verifies against the candidate
     revision: path, digest and revision. It is no longer free text.
   - `not_applicable` and `exception` need a verified `foundation-approval/1`
     record approved by the designated reviewer. This adds a fourth review
     trigger to ADR-003.
   - The obligation ids and receipt field shapes are the catalog owner's call
     in 1.5.0.
4. **Standing agent authority.** Agents may open adoption, pin-bump,
   gap-closing and invariants-ledger pull requests in every misty-step and
   r90group repository without asking the operator first. Each still passes
   its repository's gate and, where ADR-003 requires one, the designated
   reviewer. A real change in product direction still escalates to the
   operator. The operator set no freshness target for pins; the release owner
   re-pins adopted repositories as part of shipping a foundation release.
5. **The operator approves new or widened obligations.** Adding an
   obligation, widening applicability, or removing an escape needs the
   operator's approval, as ADR-005 did. Tightening a check within an existing
   obligation, rationale edits, and retiring a check nobody acts on go through
   the harness's normal review.
6. **Jev advisory pilot.** The six adopted repositories are assessed by the
   hybrid in the brief:
   - scripts distill a bounded evidence packet per foundation;
   - Jev judges each packet in one request;
   - a frontier agent adjudicates uncertain answers.

   The pilot is advisory (US-042). It never gates a merge, changes a
   disposition, or replaces a drill or a walk. Each question follows the rule
   admission procedure in `docs/semantic-quality.md`. A finding reaches a gate
   only when a deterministic check replaces it. Any other move away from
   advisory-only use needs a separate operator-approved amendment to ADR-003,
   which keeps Jev off required checks.

## Rollout

- Catalog 1.5.0 lands promptly. Adopter pin bumps to 1.5.0 wait until the
  baseline entries expiring 2026-10-25 are closed or extended, because decision
  3 adds a dated gap for every applicable pending obligation. The operator may
  ask for sooner.
- The constitution reaches agents through the `foundation` skill and a shared
  guidance section that both harnesses select (US-041).

## Consequences

- An adopted repository cannot sit indefinitely on a `pending` obligation, or
  claim `satisfied` or `not_applicable` without evidence the checker verifies.
- Each adopter's next pin bump grows its baseline. The ratchet then shrinks it,
  and the extension count shows where the standard or the setup is wrong.
- Review has one per-repository input, the ledger, instead of two.
- Agents meet the foundations while working instead of only when a check
  fails.

## Alternatives rejected

- **A per-repository `CODING_STANDARDS.md`.** It restates the catalog across
  about 48 repositories, or duplicates the ledger under a new name.
- **A committed, generated per-repository foundations view.** It puts transient
  status in core documents (ADR-004) and churns every repository on every
  release.
- **Jev on the required path.** Its answers are calibrated probabilities, not
  proof, and ADR-003 keeps it off required checks.
