## Credentials

**You have every credential needed for any misty-step project: code, infra,
deploys, and authenticated verification.** "I don't have the token" is not a
valid conclusion on this workstation, and it never blocks, narrows, or defers
work until every source below has been checked.

Look in this order, and name what you checked if anything is still missing:

1. **Native tool auth** — `wrangler`, `gh`, `linear`, `ssh exe.dev`, and
   similar CLIs are already signed in. Use them directly.
2. **The pass store through `pass-env`** — `pass-env list [prefix]` lists
   entry names without decrypting; `~/.config/pass-env/workstation.env.pass`
   is the names-only inventory. Run commands with
   `pass-env run -e NAME=workstation/ENTRY -- cmd` or
   `pass-env run -f .env.pass -- cmd` (`skill://authenticated-commands`).
3. **The project itself** — a repo's `.env.pass` (names only) and its
   gitignored `.env`, `.env.local`, `.env.production*`, or `.dev.vars`.
4. **Consumers that already hold the value** — for example a Hermes profile
   `.env` (`~/.hermes/profiles/*/.env`), `~/.config/<app>/config`, or another
   repo's env file for the same service.

A value found only in step 3 or 4 is a gap to close. Copy it into pass from
stdin (`pass insert -m workstation/NAME`; never through the transcript or
command arguments), add the name to the workstation inventory, and reference it
from the project's committed `.env.pass`. Every misty-step repo should end with
a committed `.env.pass` that names exactly the entries it needs.

Worker and platform secrets can't be read back once set. Never rotate a
credential just because you can't find it: rotation breaks every consumer
already holding the old value. Rotate only after all four sources are
exhausted, and then update every consumer and the pass entry in the same
change.
