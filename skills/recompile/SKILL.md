---
name: recompile
description: "Monthly and on a model-capability jump: review rebuilding from the vision without breaking the record or existing consumers."
metadata:
  owner: phaedrus
  prevents: "Inherited architecture surviving capability changes, or monthly rewrites breaking accepted contracts; Phaedrus's 2026-10-30 ruling on mistystack#631."
  source: "Phaedrus, 2026-10-30: make the monthly rebuild review a Mistystack practice; https://github.com/misty-step/mistystack/issues/631; Jacob Sansbury, https://x.com/jsnnsa/status/2115671437575168084; Spawn 6 engine pinning and migration, https://www.spawn.co/about/release-6-0-0 (references, not copied procedure)."
  sunset: "2026-11-27"
---

# Recompile

Review monthly and additionally when model capability jumps. This is Mistystack's
adaptation, not a claim about Spawn's internal rewrite procedure. A review may
conclude **no rebuild**; the calendar is not a reason to rewrite.

1. **Recover intent.** Re-read the project's vision and durable record: artifacts,
   actual user evidence, decisions and obligations, including its SPEC and tracker.
   Preserve provenance, accepted history and existing access/retention boundaries.
   Use [grill](../grill/SKILL.md) for conflicting intent, not code as the deciding
   authority. **Done when:** the intended outcome and continuity obligations have
   source links, and missing evidence is explicit.

2. **Start blank.** Before inspecting current code, describe the simplest system
   that achieves the intent with today's capabilities. Identify which new
   capability removes a previous constraint. **Done when:** the proposal explains
   the consumer outcome without treating inherited components as requirements.

3. **Compare.** Now inspect the implementation. For each component, give a reason
   to keep, remove or replace it. Compare the whole-system costs of keeping it,
   rebuilding part and rebuilding all, including migration, compatibility and
   operation. Use [foundation](../foundation/SKILL.md) for the quality checklist.
   **Done when:** one keep / rebuild part / rebuild all decision follows from user
   evidence and present capabilities, not sunk cost or line count.

4. **Freeze reliance, if rebuilding.** Pin the record format, command contract and
   acceptance suite before replacement work. Include accepted data, identities,
   meaning and decision/evidence history. Breaking contracts ship only as opt-in
   [editions](../../DOMAIN.md#terms); old editions keep working. Migration is an
   explicit command with a non-mutating dry run, refusal with reasons before any
   unsafe or incomplete conversion, and a tested reversal that preserves accepted
   data and history. **Done when:** the frozen contracts and executable success,
   refusal and reversal checks are named; a review alone grants no mutation
   authority.

5. **Record the decision.** Use the project's existing tracker, not a second
   ledger. Link the record, blank-sheet proposal, component reasons and chosen
   outcome. Name the accountable owner, bounded authorized replacement work (if
   any) and next monthly review date; a capability jump prompts an extra review.
   **Done when:** another owner can recover why to rebuild or keep the system and
   when to reconsider it. A no-rebuild review ends here.

6. **Prove before cutover.** Carry authorized rebuild work through
   [ship-loop](../ship-loop/SKILL.md). Cut over only after an independent acceptance
   suite run passes on the real record through the actual consumer path, including
   old-edition continuity, migration refusal and reversal. Follow
   [verification](../verification/SKILL.md) within the record's access boundaries;
   preserve the original record throughout. **Done when:** the tracker links the
   checked revision, acceptance evidence and explicit opt-in migration result;
   otherwise retain the working edition and record the failed or unproven check.
