# Generate a repo verification skill

1. **Interview the repo.** Identify real surfaces, documented start/build commands,
   readiness, ports, environment, auth, migrations and seed data. Reuse the existing
   driver before adding one: browser, PTY, HTTP or library consumer. Identify state
   ownership and whether independent instances are possible. An unusable base is
   a concrete blocker, not a recipe to preserve. Disposable launch scaffolding is
   named and removed in cleanup.
2. **Write `.agents/skills/verify-<app>/SKILL.md`.** Include `name: verify-<app>`,
   a trigger-first description and the project-grounded sections below. Keep one
   canonical source and expose it through the active harness's native mechanism.
   Repository instructions remain in AGENTS.md. Fill every command, prerequisite and check
   from source; the result must run cold without placeholders.
3. **Map features.** Write `features/README.md` and one file per discovered primary
   feature, initially the top three to five. Index each file once. Each describes
   user-visible sub-features, how a user reaches them, exact driver commands or
   selectors, observable end state and gotchas/prerequisites. Missing seed state
   is a reported prerequisite, never a weaker journey.
4. **Execute the generated recipe.** Launch, doctor, drive one mapped feature,
   capture and inspect proof, then clean up. After teardown, read proof at its
   retained location. Clean failed iterations too. A stand-in run lists every
   target setup step it did not prove; a never-executed recipe is incomplete.

## Required sections

| Section | Checkable content |
| --- | --- |
| Launch | Exact command; empty-state migrations/seed; usable readiness; owned teardown. Short-lived CLIs build once and use isolated sessions per drive. |
| Doctor | One read-only check for correct build, owned process/port and usable auth. |
| Drive | Real entry points and stable selectors/commands, including the actual user prerequisite. |
| Accounts | Project's exact authorized QA identity references, setup, production login, required role, allowlist/Access and shared-membership ownership from [accounts.md](accounts.md). Mark unauthenticated surfaces n/a. |
| Evidence | Actions and resulting state, side-effect readback, output outside checkout and reviewer-accessible delivery from [evidence.md](evidence.md). |
| Cleanup | Only owned processes/data; proof survives. Stop identified children, not every process with the same name. |
| Helpers | Executable owned scripts with their exact invocation in the skill. |

Use the real interface rather than internal setters or test-only endpoints.
Mocks belong only at an already-isolated production boundary. Observe what a
safe/test mode actually skips, including files, network and refs; its name is not
proof. Missing access remains `owner sign-in UNPROVEN: needs <access/role>`.

Done when the generated skill has driven one whole mapped feature and retained
its inspected proof. [maintenance.md](maintenance.md) owns later map upkeep.
