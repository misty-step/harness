# Mistystack specification

Mistystack gives engineers and coding agents one maintained engineering method:
a small always-on core, task routing, on-demand procedures and an outside check
that defines completion. [USER_STORIES.md](USER_STORIES.md) owns the method's
consumer stories and detailed acceptance criteria; [DOMAIN.md](DOMAIN.md) owns
its vocabulary. Product intent belongs in the repository's ticket backlog and
delivery changes in Entire. The [forge procedure](skills/misty/entire.md) owns
publication and the ticket cutover, not a second website backlog.

## Method

Consumers install and refresh one content tree through the destination harness's
native mechanism, preserve unrelated runtime state, and obtain that harness's
own installation and fresh-session loading proof. The method exposes its core,
Misty routing, principle leaves, playbooks, task skills and Oracle-before-dispatch
contract as specified in US-057–US-060 and the other maintained
[consumer stories](USER_STORIES.md). Runtime/model configuration and private
fleet machinery do not become a second copy of the method.

Project owners can reconsider their implementation from the vision and durable
record without committing to a rewrite or breaking existing consumers, as
specified in [US-062](USER_STORIES.md#us-062-recompile-from-the-vision).

## Public site

### Understand and adopt

- A visitor can understand what Mistystack is, which observed failures it
  addresses, how core → Misty → relevant method → outside proof fits together,
  and how native adapters connect to that same tree without prior repository
  knowledge.
- The visitor can choose a destination harness and reach its canonical install,
  refresh, core-loading, rigor and proof instructions. Commands come from that
  harness's maintained reference, never a different runtime's example.
- Integration status distinguishes an available native adapter, a self-install
  runtime brief, existing private consumption and missing public setup/loading
  evidence. If no public installer or loading contract is established, the site
  states that boundary instead of inventing a command or borrowing another
  harness's pass.

### Read and find the method

- Guide, Library and Evals are primary reading destinations. Foundation and
  Decisions are directly discoverable; stories, domain, exemplars, attribution,
  changelog and source links remain reachable.
- The library exposes every canonical core, mode, principle, playbook and task
  skill, including leaves hidden from automatic model discovery and supporting
  Markdown documents. A skill shows its exact installed name, trigger,
  prevented failure, owner, provenance and review/sunset date. Supporting
  documents disclose inherited provenance rather than inventing their own.
- Every page identifies its source path and revision. Headings and Foundation
  articles have shareable anchors, including the existing numeric Foundation
  aliases. Earlier decisions preserve their original bodies and disclose their
  scope and explicit supersession relationships.
- Search finds canonical documents and headings by name, phrase and prevented
  failure, supports content-type filtering and shareable queries, and provides
  useful empty/error states and browse recovery. If search needs JavaScript,
  its unavailable state says so without blocking access to the library.
- At phone sizes, navigation, long titles, metadata, tables and code remain
  readable and operable without page-level horizontal scrolling or hover-only
  controls. Keyboard focus, touch targets and heading navigation remain usable.
- Light and dark appearances follow the system by default and allow a user
  choice. Reading and navigation work without JavaScript or WebGL. Reduced
  motion and unsupported graphics do not hide content or controls.

### Trust content and evidence

- Pages, excerpts, counts, links, related documents, raw public-source
  projections and search derive from one checked-out revision of the maintained
  source. An author does not synchronize duplicate website copies of the method.
- Publication rejects unresolved required metadata, internal targets, fragments
  and duplicate identities with the source location; it does not silently
  publish a partial library.
- Each evaluation exposes its task count, arm denominators, method,
  harness/model, source revision boundaries, measurements, limitations and
  evidence availability together. Private or unavailable artifacts are labelled
  honestly. A new canonical round becomes discoverable without separately
  authored result totals or placeholder rounds.

### Review and operate

- A published review preview identifies the exact reviewed commit, links to
  affected pages/anchors and is not indexed as the public canonical site.
  Untrusted change code receives no deployment credentials.
- A public release exposes its content revision. Promotion uses the same tested
  artifact, preserves compatible forward progress, and permits recovery to a
  prior verified compatible release when a critical path fails, with recovery
  readback.
- Unknown routes return a real 404 with reading/search recovery rather than a
  successful application shell. Direct deep links, search results and source
  links preserve their intended destinations.
- Production behavior, release identity, error/uptime alerts and privacy-safe
  journey telemetry have exercised evidence under the
  [Foundation checklist](skills/foundation/checklist.md). Search-query text,
  private content and secrets are not telemetry. Telemetry failure never blocks
  reading. Missing production evidence is unverified, not a pass.

## Decision records

Architecture and operational status belong in [decision records](docs/decisions/index.md),
not in the behavior contract above. The public site's publishing-stack
exception, its commissioned deployment and its open telemetry and production
proof are recorded in [ADR 0018](docs/decisions/0018-static-publishing-stack.md).
The forge boundary and review-ledger cutover are recorded in
[ADR 0019](docs/decisions/0019-entire-is-the-forge.md).
