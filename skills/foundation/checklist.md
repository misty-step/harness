# Constitution

What every Misty Step project is, on any stack. Each article is a state an auditor can check. A deviation is a recorded decision in the repo; unverified is not a pass.

<a id="article-1"></a>
<a id="1"></a>

1. **One job, least code.** Each program is focused on one job, so the context an agent works in stays focused, and focused programs are much harder to spaghettify than large ones with many responsibilities. Unix-like small size and explicit JSON (or plain text) interfaces are the means: each program composes with others, and larger, more ambitious applications are, at core, compositions of these small programs. It uses native and existing capabilities before custom code; every custom part has a functional, aesthetic or business reason. It carries nothing (wrapper, controller, flag, cron, script, dependency or output) its user stories do not strictly need. Size is a signal: when a program or its spec outgrows one focused job, it is split; the healthy size depends on the program.

<a id="article-2"></a>
<a id="2"></a>

2. **One home per fact.** Every fact has one authoritative home that everything else references; no code keeps copies in sync. Owner decisions and product intent live in the project's Entire trails, with intent-only trails as its backlog. Work outside a repository uses Daybook-scoped trails; the [Entire forge procedure](../misty/entire.md) owns scope and publication. Powder is a read-only historical archive, not a second live authority; the repo's `SPEC.md` owns the observable behavior that realizes that intent, linking to it rather than copying initiative status or rationale. Architecture, stack exceptions and postmortems stay in repo decision records beside the code they explain; agent instructions add only local constraints and pointers. Vocabulary is a fact: each domain term has one home in DOMAIN.md, and files, symbols, branches and commits use it. A new concept gets its term there first.

<a id="article-3"></a>
<a id="3"></a>

3. **Specified.** Each program's living `SPEC.md` is complete enough to rebuild it from user stories: capabilities and observable outcomes (what users can do and why it matters), never UI flows, architecture, implementation, or whether anything is built. Shipped behavior matches it; missing or conflicting intent is a recorded gap to resolve with the owner, not permission to silently change either authority. Architecture and stack rationale belong in linked repo decision records, not the SPEC.

<a id="article-4"></a>
<a id="4"></a>

4. **Proven on the real path.** The repository has a verification skill that any agent can run from a shell. It drives the real user journey end to end on the real product: sign-in through the real production login with an [agent QA identity](../verification/accounts.md) holding the required owner/admin role where the product has sign-in, the main flows and the states that break. Automated checks run the built artifact in production-like conditions through success, rejection and recovery: authorization, data integrity, migrations, allowed and denied users and tenants. Mocks, syntax checks and sender-side proof, such as an email sent or a 200 response, are not proof. Correct implementation is distinct from a worthwhile outcome: each initiative names its intended user or business benefit, proportionate evidence from actual use, and a criterion to stop or revise it. Persona QA checks usability and correctness; it does not establish demand.

<a id="article-5"></a>
<a id="5"></a>

5. **Runnable by a stranger.** From the README alone, a fresh engineer runs the program and its checks with privacy-safe inputs.

<a id="article-6"></a>
<a id="6"></a>

6. **Continuously deployed.** Trunk is always releasable. One pipeline builds one artifact and deploys or publishes the same bytes through native deploy, version and rollback facilities, with no human approval step. Normal promotion is forward-only: deploy the newest tested build that descends from what's live; never require it to equal the current head, and never promote anything older than live. Intentional recovery may roll back to a previously verified compatible release, preserving accepted data and verifying recovery before normal promotion resumes. The live service reports its environment and release; each release carries a semantic version and a generated, reachable changelog.

<a id="article-7"></a>
<a id="7"></a>

7. **Data survives.** Accepted data is never lost: migrations are compatible, rollback to the previous compatible release is rehearsed, hosted data has an owner, backups and a proven restore, and local-only state survives crashes and upgrades.

<a id="article-8"></a>
<a id="8"></a>

8. **Loud and self-healing.** PostHog shows meaningful product journeys and their success and failure outcomes. Sentry provides actionable errors, uptime monitoring and alerts, including failed scheduled jobs and backups, tied to environment and release. Verify event receipt, useful journey analysis, and alert delivery to an owned response path through exercised success and failure; installed SDKs alone are not acceptance. Collect only privacy-safe metadata, never private content or user secrets; bound volume, retention, retries, access and cost. A detected user-facing break triggers automatic recovery to the previous compatible release. Telemetry failure never stalls the product.

<a id="article-9"></a>
<a id="9"></a>

9. **Private and secure.** No secret or private content appears in source, history, public artifacts or third-party services; public source names no private client. Retention, access, retries and cost are bounded. Dependencies and secret scans are current.

<a id="article-10"></a>
<a id="10"></a>

10. **Finished face.** Every product improves user experience (UX), developer experience (DX) and agent experience (AX) together without breaking existing behavior. Every interface supports light and dark, defaults to the system setting, and puts the primary information and action first. Every element serves the task or required information: no gratuitous text or additions, no eyebrow labels, and no secondary label repeating the primary. Layout makes taglines and helper text unnecessary where possible. Use clear labels and accessible units; provide provenance, uncertainty and calculation details when they help users interpret or trust a result, with secondary detail disclosed proportionately. Anything public has useful docs, a coherent brand, a reachable marketing page, a portfolio entry, a real-product demo and a feedback path into its backlog.

<a id="article-11"></a>
<a id="11"></a>

11. **Explicit state.** Design a workflow or application with consequential state as a statechart first: name its states and events, and keep one transition table (the chart's edges) as the home of what can happen next, so code, tests and diagrams follow the table and a change to behavior changes the table first. Use pure transitions with effects at the edges where they simplify reasoning and testing. Use append-only history and projections when audit, replay or recovery requires history, not for every stored value. Prefer native transactions and existing capabilities; do not build a state-machine or event platform for simple CRUD, where the chart is the whole design. Test relevant invariants directly, adding randomized event sequences when the transition space warrants them. Model-check the table when a wrong edge is costly and the bad order hides in interleavings, such as concurrent actors, retries, crashes, leases, or a gate that must fail closed: TLA+ is the default, Alloy suits structure, and any exhaustive checker the repository's engineers can run will do. A check names the properties it covers and its bounds, has been seen failing on a broken variant, reruns from one command beside the model, and records the commit it was last confirmed against; a pass means the properties held within those bounds, not that the system is proven.

<a id="article-12"></a>
<a id="12"></a>

12. **Agent ergonomic.** Every program lets authorized agents do anything its human user can, from account creation through create, read, update and delete of every object, through a documented, scriptable interface with clear errors, preferably a CLI. No screen-scraping, and no capability that is human-only by accident. Agents verify their own changes the way a human would, by testing behavior, so an agent alone can run and check the whole project: one command starts the app in containers with test configuration and prod-like seed data, and the repository's verification skill (article 4), generated with the [canonical verification generator](../verification/generate.md) and including formal/model checks where the state warrants them (article 11), drives that launch. Anything that needs manual third-party setup, such as a hosted backend project created by hand in a vendor dashboard, is not yet agent-ergonomic.
