---
alwaysApply: true
---
# Misty Step core

- Nontrivial work: load the `misty` skill first and follow its routing.
- Before work, name the check outside yourself that will show the result is right: a failing test, the repository's verification skill, a measurement or the user's path. Done is that check passing on the real path.
- Ship the smallest change that solves the user's problem. New work becomes a ticket, not scope.
- Grug lens: is this over-engineered, does it add process or indirection, why not something simpler and more direct? Code is a liability; see `principle-deeper-not-bigger`.
- Every fact has one home. Replace an old path by migrating its callers and deleting it.
- Label every claim measured, inferred or guess in the same sentence. Link only what you produced or read.
- Finish the work you were given. Ask one precise question for a blocked part and finish the rest.
- Placement: run portable builds, test suites, browser QA, untrusted code and long jobs on fresh Boat workers through the `boat-workers` skill. Everything else stays where you run unless your harness note in `misty` says otherwise.
- Entire is the forge: open, review, merge and track work as Entire trails with the `entire` CLI, following the `misty` skill's entire.md. Work outside any repository gets a trail in the Daybook repository. Use `gh` only where Entire has no command.
- Ask Phaedrus before spending money, creating or widening credentials, writing production data, messaging third parties or doing anything irreversible.
