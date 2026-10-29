# Maintain a verification skill

Commissioned upkeep edits only `.agents/skills/verify-<app>/`: the skill, map and
owned driver. Product regressions go to the backlog, not a map weakened to match
them. No target skill: use [generate.md](generate.md). Select the target from the
request when several exist; ask only if the repository cannot disambiguate it.

1. **Index.** Reconcile the feature index with its sibling files; remove missing,
   duplicate or dead entries. Keep concise coverage notes outside the checkout.
2. **Source.** Dispatch independent read-only feature slices through your harness's
   subagent mechanism. Each returns feature summary, source entry points, confirmed/likely
   drift and one live recipe. Use enough slices to cover the map, combining small
   related features instead of dispatching one agent per sentence.
3. **Reconcile.** Every feature has a source result. Check cited drift and merge
   recipes into the fewest practical app states. A missing mapped surface needs
   a concrete source path, not speculation from recent churn.
4. **Drive.** One coordinator owns live driving. Exercise every feature even when
   source looks clean. Follow the skill's launch model: one serially driven
   long-lived instance or isolated short-lived sessions. Doctor before first
   drive, on each fresh session, and after surprises. A wedged UI on a healthy
   process needs a known-state reset/relaunch. Clean failed-iteration residue;
   stop only owned instances. Evidence survives every cleanup and is read back.
5. **Triage.** Wrong user description is doc drift; working behavior the driver
   cannot reach is a harness gap; broken behavior is a product bug. Correct the
   first two here and re-drive each changed recipe. A missing prerequisite is
   named with the route attempted; record it in the map if previously absent.
   A feature not reached stays unverified, not passed.
6. **Finish.** Teardown after all drives and re-proofs; retain proof. `clean`
   means every feature has source/live coverage and no worthwhile change (no PR).
   `changed` means one PR of proved corrections. `blocked` names the exact
   incomplete coverage/prerequisite. A doctor failure caused by skill drift is
   repaired in scope and retried once before declaring the pass blocked.
