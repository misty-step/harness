## Workstation facts

Use native logins. Credential commands and discovery live in `skill://authenticated-commands`.
Portable heavy work uses the project's approved exe.dev VM (`skill://remote-execution`).
Desktop/GPU or data-constrained work uses `desktop-guard run -- cmd`.
Scratch belongs under `~/.cache/tmp`; `/tmp` is RAM-backed.
Audio plays into silent `agent-sandbox`; record its monitor and hand over files for the operator to play.
