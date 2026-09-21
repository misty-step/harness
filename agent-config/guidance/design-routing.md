## Design exploration routing

Before writing production UI code for anything with real design surface — a new surface, a
reimagining, a flow change, or focused component/motion work — load `skill://design-studio`
and run its loop: divergent named concepts across multiple dimensions, comparative critique,
recombination, then a spec handoff. Do not present cosmetic-only changes as design work.
One-line copy/color/size fixes do not need the loop; say plainly what changed.
Design exploration never changes a live product or a locked requirement by itself.
Generated mockups propose layout, typography, and hierarchy for breadth; UX, accessibility,
and behavior need real HTML and rendered-state QA (`skill://visual-state-review`).

Before a design-surface change is called done, run the checks exercised in the design-toolkit
trial. Deterministic copy checks: `bun agent-config/bin/design-check.ts <surface paths>` finds
dash characters, leaked engineering vocabulary, and placeholder text in player copy. Rendered
checks: axe-core on the captured states, and Impeccable's detector (`impeccable detect <file>`)
when the `impeccable` skill is installed from its supported Hermes build. Marks are 16-first:
design at 16px, prove the read on light, dark, and browser-tab backgrounds, and ship an optical
variant before acceptance. A passing screenshot does not clear copy; route each finding with
the file and line the check reports.
