## Workstation facts

- Credentials: native `gh`, `wrangler`, `linear` and `ssh exe.dev` logins; pass via `pass-env list [prefix]` and the names-only `~/.config/pass-env/workstation.env.pass`; project `.env.pass` and ignored environment files; existing consumers such as `~/.hermes/profiles/*/.env`. `skill://authenticated-commands` owns discovery and migration. Run secrets with `pass-env run -f .env.pass -- cmd` or `pass-env run -e NAME=workstation/ENTRY -- cmd`.
- Portable heavy execution: `ws` in the project's owned `<project>-ws` exe.dev VM. Model credentials stay local. Native desktop/GPU or data-constrained heavy work uses `desktop-guard run -- cmd`; bounded inspection can stay local. Scratch: run-scoped `TMPDIR` under `~/.cache/tmp`; `/tmp` is RAM-backed.
- Audio plays into silent `agent-sandbox`; default `pw-record` or `parecord` records its monitor. Hand audio over as files for the operator to play.
