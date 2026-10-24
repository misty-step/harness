# Cloud Home → mirrodin: read-only route investigation

Observed 2026-10-21 for [review H1](https://github.com/misty-step/harness/pull/419#pullrequestreview-5594063871).
**BLOCKED for complete Home dispatch.** T3 reads work from the cloud host; handoff,
fallback inbox and source/installed roster filesystem access is not validated.
No succession was launched. No Home thread was impersonated or sent a message.

## Supported T3 route observed

The existing executable `/home/exedev/.local/bin/fleet-t3` on
`cloud-home-agents` calls the product's HTTP MCP API. Its `mirrodin` target is
`https://mirrodin.tail5f5eb4.ts.net:8444/mcp`. It consumes the already-stored native
MCP authorization without displaying it. This investigation used only `call` and
`tools`, never its credential-issuing `issue` or `oauth` commands.

From cloud Home's actual host, these read calls succeeded:

```sh
printf '%s' '{}' | ~/.local/bin/fleet-t3 call mirrodin t3_environment_read
printf '%s' '{"threadId":"mcp:614bca31-1183-4c15-95f3-61f64329e94a","limit":1,"maxCharsPerItem":100}' |
  ~/.local/bin/fleet-t3 call mirrodin t3_thread_read
printf '%s' '{"threadId":"mcp:614bca31-1183-4c15-95f3-61f64329e94a"}' |
  ~/.local/bin/fleet-t3 call mirrodin t3_thread_configuration
printf '%s' '{"threadId":"mcp:614bca31-1183-4c15-95f3-61f64329e94a","query":"lane-succession","limit":20}' |
  ~/.local/bin/fleet-t3 call mirrodin t3_worktree_list
```

[Receipts](route-receipts.json) identify environment `mirrodin`, its existing
[Process lane](t3-thread://v1/mcp:614bca31-1183-4c15-95f3-61f64329e94a), the exact
project, model/options/modes and this PR's existing worktree. The builder invoked
these commands through `ssh -o BatchMode=yes exedev@cloud-home-agents.exe.xyz`;
they ran on cloud, not against the builder's local MCP server. Home itself did
not run a turn for this test. The remote catalog exposes `t3_thread_launch`
with `projectId` and `existing_worktree`; catalog presence is not launch proof.

The local mirrodin MCP read of cloud Home
`mcp:d6c7a67c-bddc-426e-8513-0f6efb56a0d0` returns `thread_not_found`. Thus local
MCP calls are not a substitute for the explicit remote target.

## Missing filesystem route

- From cloud: `ssh -o ConnectTimeout=10 mirrodin-hq help` exits 255:
  `phaedrus@100.93.28.18: Permission denied (publickey).`
- Cloud's existing `mirrodin-root` alias with strict host checking exits 255:
  `No ED25519 host key is known for 100.93.28.18 and you have requested strict checking.`
- Testing that alias against the already-trusted HQ gateway host entry also
  fails host verification: the port-22 endpoint presents a different key.
  No known-hosts entry or credential was changed and checking was never disabled.
- The remote MCP tool catalog offers project/worktree metadata, but no shell or
  filesystem read/write tool. It cannot read the handoff or either roster file,
  or run the existing installer, through the inspected tool surface.

**Prerequisite:** validate an existing authorized filesystem route from cloud
Home to the lane user's handoff directory, local fallback inbox, maintained
harness checkout and installed `t3-pool.json`, including the native deployment
command and fresh readback. If repairing access requires credentials or host
trust changes, that is outside this builder's scope. Do not infer this access
from the working T3 API, from a direct SSH alias, or from the mirrodin builder's
own filesystem access. No new transport is implemented here.

Until that prerequisite is met, dispatcher step 0 blocks launches. A full
Home-dispatched succession remains **UNPROVEN**; the documented route is partial,
not satisfaction of H1. The installed roster is also still absent pending
[pool PR #420](https://github.com/misty-step/harness/pull/420). The independent
review/judge must retain H1 as a blocker. Timer and native auto-resume stay off.
