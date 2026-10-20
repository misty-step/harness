## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.
Claude Code denies reading or editing `.env` files by design; that is not a guard block or a BLOCKED-ALLOWED case, so never route around it.
Use values through `pass-env run -f .env.pass -- <cmd>`, take variable names from `.env.example`, and ask the human for a value or an `.env` edit.
