# pass-env contract

`pass-env` needs Bun/pass/GPG, not a harness session. Literal reference files allow
blank lines/comments, reject duplicate names and do not evaluate shell syntax.
Later `-f` files win; `-e` overrides them and mapped values override inherited env.
Unmapped env, cwd and stdio remain unchanged.

An entry's entire UTF-8 plaintext is its value, including newlines, not just the
first line; no `NAME=`, quotes or notes. NUL/invalid UTF-8 reject. Lookup failure
prevents child launch; locked GPG never waits for pinentry. Changes affect new
children only and do not replace application dotenv loading.
