## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.
Claude Code denies reading or editing `.env` files by design; that is not a guard block or a BLOCKED-ALLOWED case, so never route around it.
Finish a non-secret setting yourself; it needs nobody's approval. For one run, pass it inline: `FOO=bar <cmd>`.
To make it persist, put it in configuration the app already reads outside `.env`; if the app reads only `.env`, add it inline to the repository's maintained launch command (its `package.json` script, Makefile or justfile target, or run script) and ship that through the normal PR flow.
Run commands that need secrets with `pass-env run -f .env.pass -- <cmd>`, taking variable names from `.env.example`.
Only a credential that doesn't exist yet goes to phaedrus, because creating one is on the ask-first list: post the ask to Home's inbox with `home post --from <Lane>`.
