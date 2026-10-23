---
name: t3-access
description: Drive T3 threads from an outside agent and diagnose MCP or provider access failures.
---

# T3 access

Use `t3-agent` in an environment with an existing Fleet catalog and its existing
credential references. Run `hostname` first: the agent computer and the target
T3 server are separate execution environments.
The executable requires Python 3.11 or later; use the configured user PATH over
SSH, since a machine's system Python can be older than its installed runtime.

```sh
t3-agent servers
t3-agent --server <catalog-id> tools
t3-agent --server <catalog-id> call orchestrator_capabilities '{}' > /path/to/capabilities.json
t3-agent --server <catalog-id> call t3_project_list '{"limit":10}'
t3-agent --server <catalog-id> call t3_thread_list '{"projectId":"<returned ID>","limit":10}'
```

The catalog owns server URLs. Live tool schemas and `orchestrator_capabilities`
own provider IDs, models, options and modes; discover them on the target server.
Filter the saved catalog to the requested provider before reading it: unrelated
provider catalogs can exceed an agent's context window. Do not print the full catalog.
Read usage through the installed Upkeep interface (`upkeep room` when available).
An outside agent's own usage allowance is separate from T3's subscriptions.

For authorized independent work, use `t3_thread_launch` with a project,
`modelSelection.instanceId`, `modelSelection.model`, supported options and an
explicit `workspaceStrategy`. Put the task in `message`. Use `scratch:true` for
an authorized disposable measurement. Save the returned thread ID before
another operation. Read with `t3_thread_read`; send with `t3_thread_send` and a
stable `clientRequestId`; wait with `t3_thread_wait`; settle with
`t3_thread_organize` action `settle`. Use `delegate_task` for authorized child
work. Pass long JSON through `call` as `@file` or `@-`.
Read the terminal response: an accepted launch does not prove the selected
subscription can execute it. A provider quota failure is not an MCP auth failure.

Some tools require a calling T3 thread. External `preview_open` fails with:
`This tool acts as the calling T3 thread, so it needs an agent running inside
T3 Code. This MCP client signed in from outside a thread.` Ask your owned
in-T3 helper to call `preview_status`, `preview_open`, inspect the requested
page and return sanitized results. A wider token does not create thread context.
Use an explicit thread-context API only if the live schema supplies one.

## Recovery

- Timeout or `ECONNRESET`: record execution host, target and exact operation;
  check the existing tailnet/proxy and service. An agent-computer outage does
  not establish a T3-server outage. Read before retrying an uncertain write.
- `No MCP servers configured.`: select the existing MCP profile and verify its
  wrapper/PATH. Use the private operator guide for environment-specific paths.
- SSH `Permission denied (publickey)`: inspect configured user and identity;
  preserve host-key checking and existing keys.
- HTTP 401/403: separate T3 MCP authorization from provider login. Report the
  rejected operation and needed permission. Preserve working credentials.
- `workspace routing discovery unauthorized (401)`: provider execution failed;
  this does not establish a model refusal or a failed T3 transport.
- Missing CLI/catalog: use its maintained installation in an already authorized
  environment. Do not invent URLs or copy authentication files into the agent.

Keep subscription credentials on their owning hosts. Never copy refresh tokens,
print credentials, create pairings/keys, or issue temporary operator sessions.
`t3-login-helper status` issues a session and needs approval. Native refresh of
an existing configured login is distinct from creating a credential. Permission
to use a Fleet credential through its configured CLI does not authorize putting
it in a different app. New tokens or changed scopes need owner approval.
