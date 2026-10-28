# QA accounts and shared state

For a journey with sign-in, use the agent's own AgentMail QA identity and `pass`
references under `workstation/<PROJECT>_QA_*`. Within the assigned app scope,
creating that QA account, storing its credentials in pass, granting its required
QA owner/admin role and adding its address to allowlists or Cloudflare Access
are authorized verification setup. This narrow exception permits no unrelated
credential, access or customer-data changes. Use `skill://authenticated-commands`
from the workstation plugin for credential discovery and injection.

Prove a successful production login and the required owner/admin role through the
actual app. A sent email, HTTP 200, login without the required role or native CLI
subscription is not that proof. Missing access after setup is
`owner sign-in UNPROVEN: needs <exact access/role>`. Continue reachable proof;
name the blocked criterion. The human owner's password or a profile they must
sign into is not a QA prerequisite.

## One writer

One writer owns each shared account/resource at a time. Others read or request
its writer. Pass secret references, never values, in logs, messages or proof.
Worktrees, tabs and contexts do not isolate shared backend state.

Process owns shared auth `HOUSEHOLD_MEMBERS` in GitHub Actions and the Worker
binding until Home reassigns it. QA/app lanes send Process the exact approved QA
email and private identity reference; Process performs the shared write:

1. Load the complete, versioned private encrypted membership snapshot fresh from
   pass or native private config. Hold only this write if the baseline is missing;
   obtain the existing writer's canonical reference and provenance while other
   app setup continues.
2. Merge only the exact approved address, preserving every existing member,
   owner and alias setting. Serialize the whole operation.
3. Validate with auth's native account-config checker. Update Actions and Worker
   through the native path from the same payload.
4. Retain write receipts and prove the new QA login. Secret counts and successful
   writes do not read back values or prove membership.

This path permits no secret printing, rotation, revocation, unrelated access
change or additional approval gate. Cleanup removes only the run's disposable
QA data, not a shared account or membership that other journeys still use.
