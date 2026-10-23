# T3 access

The affected consumer is an agent using the installed `t3-agent` executable.
Use existing authorized credentials. This recipe never issues sessions or
changes the T3 server. Native subscription login is execution authentication;
there is no separate product QA account for this CLI.

1. On the CI host, run the executable boundary tests:

   ```sh
   python3 -m unittest discover -s agent-config/bin -p 't3-agent.test.py' -v
   ```

   Pass means the real HTTP client handles SSE, sends each write once, rejects
   invalid input before a request, redacts the credential in errors, and posts
   a failure once followed by one recovery notification.

2. Install only the candidate executable into an isolated directory and read
   its help. Use `agent-config/install --agent-dir <private-agent-dir>
   --home <private-home> --bin t3-agent`. The installed executable must match
   source. This is a private installation, not a live deployment.

3. Invoke that executable with `--config <existing-catalog> --server <id>`.
   Run `tools`, then `call orchestrator_capabilities` and `check`. Record the
   environment/version and live model IDs, not any credential values.

4. Through `call t3_thread_launch @-`, create a disposable scratch thread on
   an available subscription, retaining the returned thread ID. Read the
   completed response, send a second nonce, read that response, then call
   `t3_thread_organize` with `action: settle` and read back `settled: true`.
   A launch acknowledgement alone is not a successful provider run.

5. Save sanitized results outside the checkout and link them in the PR. Never
   retain raw authorization headers, environment dumps or whole transcripts.
   Do not treat an unavailable credential or a provider limit as a passing
   control path. Do not replay a write after an unknown response; inspect the
   thread first.

The endpoint catalog is the existing Fleet TOML file. Credentials resolve
through its `token_env` or `token_pass` fields. Missing authorization is a
blocker for that server; it does not authorize creating or widening a token.

The optional systemd units in `agent-config/t3-access/` run one read-only check
per configured server every five minutes. Install their maintained bytes into
the user unit directory, set `T3_ACCESS_REPORT_URL` in
`~/.config/t3-agent/watch.env`, and enable `t3-access@<server-id>.timer` for only
the intended servers. Check the loaded unit and first execution result. These
units do not restart T3 or refresh its credentials.

For a machine that already has T3 OAuth connections in a Claude profile, use
`t3-agent --claude-profile <profile-directory> servers`, then add
`--server <returned-id>` for calls. If its tailnet is behind an existing SOCKS
proxy, also pass `--socks-proxy <host:port>`. This reads the matching server's
existing OAuth access credential in place, without a model call, login, refresh
or credential copy. Repeat the same thread round trip from that actual machine.
The native-profile tests check that server discovery reads no credentials and
that cache lookup matches both server name and URL.

When only another machine holds the authorized profile, pass `--via <ssh-host>`
for each existing SSH hop in order. The remote machine needs the same installed
CLI; host-key checks remain strict. `@file` arguments are read locally and
forwarded on stdin. `check --notify` posts on the originating machine, including
when SSH fails, so the remote computer needs no Home credentials. Optional
`T3_ACCESS_ARGS` in the watcher's environment file can supply this route and the
native profile/proxy arguments.
