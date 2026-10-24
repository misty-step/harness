# M5 and L1 builder delta

Story: US-050

Tested source: `b169c57` on `process/lane-succession`, based on `d54e5df7ac6934d90fe7278f23ebdd965ec66769`. This evidence commit changes no maintained source. Owner sign-in is n/a for installed guidance; doctor confirmed the existing native logins. The owner email was redacted from the transcript.

This is author-run evidence for the [judge's M5 and L1 fixes](https://github.com/misty-step/harness/pull/419#issuecomment-6306564916). Independent delta QA and review remain required. **H1 stays BLOCKED. The real Home-dispatched journey is unproven.** Home's own scratch route proof was requested by the parent and has not returned. No access, trust or credentials were changed or retried here.

## Changed behavior

A claim stops predecessor work without settling it. Successor step 4 owns settlement after Continued check 4. Abandonment now stops, settles and explicitly retitles A; restores the predecessor's original title and unsettled state; and restores the source and installed roster with every other root ID unchanged. Each step requires a fresh read before mutation and readback before advancing. Home rereads every result before reopening the request. A stays inactive.

Reporter, dispatcher and successor checks ignore A and its permanent marker only after that complete verified abandonment. Settlement alone or an abandoned title alone is insufficient. Other claims, unresolved candidates and unknown reads still block. The original first-message and request markers are byte-unchanged; optional L2 was skipped.

The route evidence link now pins existing baseline `d54e5df7ac6934d90fe7278f23ebdd965ec66769`. An [authenticated GitHub contents lookup](route-link.json) resolved the exact target and blob. This proves the link target exists independently of branch deletion. It proves no Home route.

## Results and reproduction

The [transcript](transcript.txt) records the verification skill's doctor, affected `check shared`, private `install b169c57` and `session both` commands. They used `VH_DIR=/home/phaedrus/.cache/tmp/vh-419-m5` and this directory as `VH_EVIDENCE`.

- [Shared gate](check.log): passed, including 174 installer assertions and zero failures.
- [Private install tree](install-tree.txt): both native installers exited 0, composition and byte comparisons passed, foreign guidance was preserved, and only the fixture systemctl received daemon-reload.
- Fresh [Claude loading](claude-isolated-instructions.jsonl), [Claude skills](claude-isolated-init.json), [Codex loading and skills](codex-isolated-summary.txt), and [repository skill registration](registration-codex.txt) passed. The private Claude model's expected unauthenticated result is retained in [its result](claude-isolated-result.json); it is not a successful model answer.
- A separate fresh native authenticated consumer actually read the private installed skill with Read as its only tool, safe mode, no persistence and no MCP servers. Its [command](consumer-command.json), [prompt](consumer-prompt.txt), [Read receipt and decisions](consumer-result.json), and [label adjudication](consumer-adjudication.json) are retained. All 20 new cases match exactly. Across all 69 cases, 65 action labels match exactly and four safe label differences preserve the required effects. All eight effort mappings return exactly the counterpart effort option.
- [All original 49 scenarios](retained-49-cases.json) are byte-unchanged from [independent QA's cases](https://mirrodin.tail5f5eb4.ts.net/process-succession419-qa-6ac895c/consumer-cases.json). In particular, `marker-only` and `settled-predecessor` remain DENY. Only complete, explicitly marked abandonment permits B. No old denial was weakened by rewriting a scenario.
- The [installed roster command results](roster-results.json) pass all 10 original validation cases and four exact membership readbacks. The command is extracted from the installed skill and executed against disposable roster files.

Run `python3 probe.py --private-home <private-installed-HOME> --scratch <dedicated-scratch-directory>` from this evidence directory to repeat the roster commands and regenerate the 69-case prompt. Run the recorded native command with that prompt on stdin. The probe generates instruction decisions only; it executes no succession effects.

The 20 new cases cover completed abandonment allowing B, B claiming without aborting on A, B adopting only after its own swap, settled but unmarked A, unsettled abandoned A, missing installed readback, partial rollback, remaining old claim title, a settled predecessor, another live marker for Home and B, reporter resolution and rejection, delayed predecessor settlement, successor settlement before and after check 4, a dropped unrelated root, inactive A, a newly parked predecessor, and an unknown abandonment read.

## Retained proof and limits

[Preservation receipts](preservation-and-runtime.json) show only the skill changed in maintained source. Guidance, Heartbeat, pool code, installers, verification helper and USER_STORIES.md are unchanged from baseline, preserving US-048 criteria 1–8. Master was still `f947793`; `ec4229b` was already an ancestor. No rebase or merge was needed.

B1, M1–M3 and R1, R2, R4, R5 remain resolved. M4's ordering/readback proof is retained with M5's abandonment fix added here. R3 still depends on [pool PR #420](https://github.com/misty-step/harness/pull/420). R6 remains resolved in instructions; R7 remains mitigated but unproven live. Earlier A/B/B2/C/D observations cover only unchanged handoff/history and task rebinding operations. Their old claim and settlement observations are historical; they do not prove the revised settlement ordering, abandonment, Home authorization or roster restoration.

The [independent baseline QA](https://github.com/misty-step/harness/pull/419#issuecomment-6306427263) retains ten actual live drift/loading failures plus one heading-format assertion failure. They are not PASS and were not rerun here. This delta's private loading and consumer decisions do not erase them.

Read-only runtime receipts still show installed `wipRoots` absent, `t3-pool.timer` disabled/inactive and `autoResumeLimitedThreads: false`. No live install, config/roster mutation, Home post, new top-level thread, nested agent, timer, credential/trust change, merge, watch or PR polling occurred. Only source, scratch verification state and this evidence were written. PR #420 must merge and deploy with valid named installed `wipRoots` before activation. H1 still requires Home-owned route receipts or a real authorized Home-dispatched succession; no claim of end-to-end verification or SHIP is made.
