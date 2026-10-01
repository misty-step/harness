# agent-config

Own harness-neutral primitives consumed by Pi and OMP: shared skills, guidance,
launchers and the audio sandbox. Harness-specific routing stays with its consumer.

Edit source here. Both consumers call `./install` with their selections;
`AGENT_CONFIG_DIR` overrides the sibling path. Shared guidance sections splice
at `<!-- shared guidance: agent-config -->`. The installer preserves foreign state.

Run `../scripts/check shared`, including both fresh-clone consumers. Compare
composed guidance with live output before deployment. `README.md` records
provenance and package contracts; external skills remain upstream-owned.
