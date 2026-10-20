# Home post

Harness guidance tells every lane to report to phaedrus with `home post --from <Lane>`, Markdown on stdin. Home is an external CLI (`~/home/bin/home`, not in this repository). When `~/.local/state/home/primary.json` exists, it runs every command over SSH on the cloud primary. This feature proves the posting contract without reaching phaedrus, and proves the route answers.

## Sub-features

- `post-append`: a post answers `## <YYYY-MM-DDTHH:MMZ> [<Name>] post:<16 hex>`.
- `post-roundtrip`: `home inbox --all` reads the body back intact under its header, including a `## ` line inside the body.
- `post-refusals`: an empty body and a name containing `]` are refused, and nothing is written.
- `post-route`: the routed `home` answers over SSH.

## How to get to it (user POV)

- `printf '%s\n' "<report>" | home post --from "<Lane>"`.
- `home inbox` shows unread entries.

## Driving it with verify-harness

Preconditions:

- `verify-harness install` passed in this `VH_DIR`.
- Doctor shows `home` on PATH.

- **Post privately.** Run `verify-harness home`. With `HOME_FLEET_LOCAL=1` and `HOME_INBOX=<run>/home-inbox.md`, expect `PASS home post answered ## <stamp> [Verify harness] post:<id>`.
- **Read back.** Expect `PASS home inbox reads the post back under its own header, body intact`.
- **Refuse bad posts.** Expect `PASS empty body refused`, `PASS name with ] refused` and `PASS refused posts wrote nothing`.
- **Probe the route.** Expect `PASS routed home answers over SSH from its cloud primary: usage: home [-h] ...`. This runs only `home --help` on the primary.
- **Proof.** Keep `home-readback.md` and the home section of `transcript.txt`.

## Gotchas

- Never prove posting with a real `home post`. It lands in phaedrus's inbox. The drive's own post goes to a private file.
- The autonomy guidance's fallback appends to `~/.local/state/home/inbox.md` when `home post` fails. With a cloud primary, `home` only reads the primary's inbox and forwards nothing from that local file. Fallback reports are lost: [#418](https://github.com/misty-step/harness/issues/418). Doctor and this drive print a `NOTE` while the route exists.
- The routed probe needs non-interactive SSH (`BatchMode=yes`) to the primary. A failure there means real posts fail too.
