# 0018: Static publishing, not a full-stack service

Status: accepted, 2026-10-28; deployment commissioned, 2026-10-29.

## Context

The [public-site consumer contract](../../SPEC.md#public-site) is a pitch and
searchable handbook for the method already maintained in this repository.
Visitors need readable pages, truthful installation/proof boundaries, source
provenance and linked evaluation evidence, not accounts or server-owned state.
The Agent Skills tree must remain usable without website tooling or a second
copy of the method.

[Foundation's stack defaults](../../skills/foundation/SKILL.md#stack-defaults)
prefer full-stack Rust on Cloudflare and permit story-driven exceptions recorded
beside the code and linked from SPEC. A publishing pipeline does not earn a Rust
service or a WebAssembly program merely to display Markdown.

## Decision

Use an isolated `site/` package with **Astro static output, Pagefind post-build
search and Cloudflare Workers Static Assets** as the hosting target. This is an
explicit publishing-stack exception to the Rust/UI-WebAssembly default, not an
exception to Foundation's observable outcomes. No request-time application
Worker, database, CMS or GitHub API dependency is required to read the handbook.
Pagefind's Rust CLI does not make the frontend Rust.

Keep the root `package.json` as the pi package. Build the site from canonical
repository Markdown through one source graph, with source-relative link
resolution, source metadata, generated routes and search. Do not copy content
into an authored website-only tree. Optional search and visual enhancements may
use client JavaScript; reading and navigation do not depend on it.

## Alternatives

- **Separate site repository:** viable with pinned sources, but adds cross-repo
  synchronization and splits review of method and presentation. A same-repo
  `site/` boundary keeps those changes atomic without changing native packages.
- **Next.js/OpenNext SSR:** no server or personalization story earns the runtime.
  Next static export is viable, but React application conventions add machinery
  without a reader advantage for this source tree.
- **Zola:** a viable Rust static generator, not a technical impossibility. Its
  content-tree/frontmatter conventions would require a generated projection of
  the existing skills/docs layout; Astro's arbitrary-filesystem content loading
  and opt-in islands fit the source graph and custom layouts more directly.
- **Custom Rust generator or WASM reader:** reinvents Markdown, routing, linking
  and search, or makes reading depend on a program, without a consumer benefit.
- **Cloudflare Pages:** not selected; Workers Static Assets supplies the chosen
  assets-only delivery model without request-time application code.

## Consequences and operational boundary

The method stays harness-neutral and has one content home. Website dependencies
and build output stay inside `site/`, outside native plugin/package discovery.
The tradeoff is a JavaScript build toolchain and a separately maintained content
transform; unresolved source links, fragments or required metadata must fail the
build rather than silently omit material. The site renders original decision
bodies and identifies known supersession instead of rewriting historical claims.

**Deployment commissioned.** Phaedrus commissioned deployment of
`stack.mistystep.io` on 2026-10-29. Production serves `master`: a maintainer
runs `npx wrangler deploy` from `site/` at a checked master commit, which
publishes `site/dist/` to the Worker and custom domain named in
`site/wrangler.jsonc`. This hand step stays until a CI deploy credential is
approved. Its `workers.dev` preview URLs send `X-Robots-Tag: noindex`.

Telemetry is open in
[#622](https://github.com/misty-step/mistystack/issues/622), and the
production Foundation proof (real-path verification, the pipeline deploy and a
rehearsed rollback) is open in
[#623](https://github.com/misty-step/mistystack/issues/623). A local build,
browser review or repository gate is not a production Foundation pass.
Real-path production proof, delivery/recovery and PostHog/Sentry receipt/alert
evidence remain unverified under
[articles 4](../../skills/foundation/checklist.md#article-4),
[6](../../skills/foundation/checklist.md#article-6) and
[8](../../skills/foundation/checklist.md#article-8) until those issues close.
Static output does not silently waive these obligations; a later justified
deviation needs its own record. No live release or telemetry success is
claimed here.

Revisit this exception if a real consumer story requires server-owned behavior,
or if the source graph cannot preserve the existing method's loading and linking
contracts. Do not add a runtime merely for framework symmetry.
