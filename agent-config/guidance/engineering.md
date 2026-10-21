Before engineering, review, release, incident, or audit work, read [Foundations](https://foundations.mistystep.io/).

Every authored PR body has a `Story: <ID>[, <ID>]` line with story IDs from SPEC.md or USER_STORIES.md. Use `Story: none` when no story applies. Machine-generated, generator-only release PRs are exempt.

## Instruction files

`AGENTS.md` is the only instruction-content filename in every repository and host. Claude Code reads it natively. Create no `CLAUDE.md`, including symlinks, fixtures, generated files and private proofs. Preserve foreign instructions and use the owned harness migration to preserve legacy content and remove owned aliases.

## Verification

Nothing is verified until the repository's verification skill has driven the real user journey end to end on the real product, with the evidence linked. When the product has sign-in, that journey signs in to production with the agent's own AgentMail QA account and proves the required owner/admin role; proving only the sender side, such as an email sent or a 200 response, is not proof. For a CLI, library, configuration or documents, the journey is what its user does (install, run, read the result), and owner sign-in is n/a. A change is user-facing when anything its user sees, runs or reads changes, including docs and installed guidance. An internal change, with nothing a user can observe, needs proof that it composes instead. A repository without a verification skill gets one, made with `create-verification-skill` at `.agents/skills/verify-<app>/` with a `.claude/skills/verify-<app>` symlink: add it in the change, or stack the change on the open PR that adds it.

Agents use their own AgentMail QA account for every app, with credentials in `pass` at `workstation/<PROJECT>_QA_*`. Within the assigned application scope, agents are authorized to create that account, generate its credentials and store them in pass, grant its required QA owner/admin role in production, and add the QA identity to required allowlists or Cloudflare Access. This is the narrow QA setup exception to the global ask-first rules for credentials and production-data writes. It authorizes no unrelated credentials or customer-data changes. Use disposable QA data. Owner proof means a successful production login with the required owner/admin role and linked evidence; a login without that role is unproven. Never ask for phaedrus's passwords or a throwaway browser profile. Native CLI subscriptions are execution authentication, not product QA accounts.

Process is the sole writer of shared auth `HOUSEHOLD_MEMBERS` in GitHub Actions and the Worker binding until Home explicitly reassigns ownership. App/QA lanes request exact approved QA email additions from Process; they never write this shared list directly. Process keeps a complete, versioned, private encrypted canonical membership snapshot in pass or native private config. Process serializes the whole change, reads that snapshot fresh, merges only the exact approved QA email, and preserves every existing member plus owner and alias settings. Process validates with auth's native account-config checker, updates Actions and Worker through the native path from the same payload, and retains receipts and a real new-QA login proof. API secret counts are not readback. If the complete baseline is unknown, hold only the shared write and obtain the existing writer's private canonical reference and provenance; continue app QA setup without asking for personal passwords. This permits no secret printing, rotation, revocation, unrelated access changes or new approval gate.

When creating or refreshing verification skills, apply this mandatory override to `create-verification-skill`, including rollout workers: canonical `.agents/skills/verify-<app>/` with a `.claude/skills/verify-<app>` symlink; `AGENTS.md` alone with no `CLAUDE.md`, including symlinks; the AgentMail QA account, pass references, production login and owner/admin role proof above. The generated skill must state the exact authorized account setup, role checks, allowlist/Access needs, evidence and cleanup. Read credentials through `authenticated-commands`; missing QA access is reported as blocked, never replaced by a request for phaedrus's password. Run harness's `scripts/probe-agent-policy --verification <repo>...` on each generated repository before handing it back. This override applies even when the upstream generator suggests other paths or identities.


## Initiative delivery

Specs, PRDs, grill-with-docs and to-spec state the full value and whole outcome. The lane leads subagent teams, splitting that design into the smallest atomically shippable PRs: each keeps main working and is worth merging alone. Prefer the smallest diff that achieves its unit; build independent slices in parallel and sequence dependencies while preserving an elegant end design. Most small focused PRs use light rigor and one round under [ship-loop](skill://ship-loop/roles.md#rigor). Parallel children count against the lane budget by model, effort, speed and reset distance.

## Design

For design work, follow [Foundations' way of working](https://foundations.mistystep.io/way-of-working): default to neutral, professional interfaces with plain words and standard product design at Linear, Vercel and GitHub quality; no clever wording, decorative themes or metaphors; light and dark follow the system setting. Use [Emil Kowalski's design-engineering skill pack](skill://emil-design-eng); do not use Mobbin.

## Agent ergonomics

What we build is maximally agent-ergonomic, per [Foundations](https://foundations.mistystep.io/) article 12. Leave the operator no manual steps; use computer use when direct automation falls short.
