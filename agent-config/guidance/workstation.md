## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.
Claude Code denies reading or editing `.env` files by design; that is not a guard block or a BLOCKED-ALLOWED case, so never route around it.
Pass a non-secret setting inline for one command (`FOO=bar <cmd>`), or put it in configuration the app already reads outside `.env`; neither needs anyone's approval.
Run commands that need secrets with `pass-env run -f .env.pass -- <cmd>`, taking variable names from `.env.example`.
Only a credential that doesn't exist yet goes to phaedrus, because creating one is on the ask-first list: post the ask to Home's inbox with `home post --from <Lane>`.
