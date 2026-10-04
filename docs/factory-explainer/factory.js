"use strict";
// Teaching content, never a writable run projection or live fleet inventory.
const revision = "6569fb1c3565137b043a90f91d54dad456d3ad3e";
const source = path => `https://github.com/misty-step/harness/blob/${revision}/${path}`;
const adr = source("docs/adr/010-local-cto-summon-factory.md");
const protocol = source("agent-config/candidates/summon/factory/README.md");
const evidence = source("agent-config/candidates/summon/evidence/README.md");
const relay = source("agent-config/candidates/mage/README.md");
const glass = "https://mirrodin.tail5f5eb4.ts.net:8443/";
const related = pairs => `<div class="related" aria-label="Related components">${pairs.map(([id,label]) => `<button data-topic="${id}">${label}</button>`).join("")}</div>`;
const links = pairs => `<div class="source-links"><span>Provenance · source pinned to ${revision.slice(0,7)}; source is not deployment proof.</span>${pairs.map(([url,label]) => `<a href="${url}">${label}</a>`).join("")}</div>`;
const topics = {
  coo: {
    kind:"Ownership", title:"The COO chooses what matters.",
    body:`<p class="lede">Kaylee keeps the strategy conversation available while engineering works.</p><ul><li>Owns priority, commitments, business decisions and accountability to Phaedrus.</li><li>Writes commitments in Glass or the current project tracker.</li><li>Commissions the CTO; receives bounded results and genuine authority decisions, not every worker message.</li></ul><div class="callout">An engineering hold must not freeze the COO conversation or silently change Kaylee’s Hermes identity.</div>${related([["cto","The technical handoff"],["glass","Replace the tracker"],["hermes","Hermes interface"]])}`,
    sources:[[adr,"ADR-010 · one authority per fact"]]
  },
  cto: {
    kind:"Ownership", title:"The CTO drives delivery.",
    body:`<p class="lede">Turn the commission into scoped engineering, then keep going until the consumer has the result.</p><ul><li>Owns discovery, detailed briefs, sequence and technical dispositions.</li><li>Dispatches engineers, obtains independent review and exercises the actual candidate.</li><li>Coordinates authorized landing, deployment and observation through each project’s existing route.</li></ul><div class="callout">A finished agent turn, a merge and a verified artifact are three different things. None alone means the product is Done.</div>${related([["summon","Run mechanics"],["proof","Independent proof"],["release","What shipping means"]])}`,
    sources:[[adr,"ADR-010 · CTO ownership and actor/guard map"]]
  },
  glass: {
    kind:"Replaceable client", title:"Glass holds commitments, not runs.",
    body:`<p class="lede">Keep why, victory, priority and decisions with their original owner.</p><pre>Glass or another tracker\n          │ frozen brief + source reference\n          ▼\n      Summon task\n          │ owner-stamped read projection\n          ▼\n   any authorized viewer</pre><p>Glass is a replaceable commitment client. A standalone Summon task needs neither Glass, Git nor Mage. Replacing the tracker must not migrate or rewrite execution truth.</p><div class="callout">A failed reader shows unknown. This explainer does not author Glass status or rebuild Glass as a chat/controller.</div>${related([["summon","The task envelope"],["packets","Source-backed views"]])}`,
    sources:[[adr,"ADR-010 · tracker replacement boundary"],[glass,"Private Glass · governing commitments"]]
  },
  mage: {
    kind:"Client / landed source", title:"Mage carries the conversation.",
    body:`<p class="lede">A thin executive client, not a scheduler or second run ledger.</p><p>Commission, inspect and acknowledge through the shared authenticated project contract. The transport keeps delivery IDs, payload/session bindings, send-intent and receipt references. Summon keeps the run facts.</p><ul><li>PR237 landed scoped Mage HTTP client source.</li><li>Transport acceptance is not native acknowledgment.</li><li>Device or executive replacement preserves command identities; it does not copy Kaylee’s profile or mint a new run.</li></ul><div class="callout">Merged HTTP transport is not proof of authenticated real factory operation.</div>${related([["pi","Pi boundary"],["summon","Run authority"],["grok","Away-from-desk interface"]])}`,
    sources:[[relay,"Mage · current source contract"],["https://github.com/misty-step/harness/pull/237","PR237 · merged HTTP transports"]]
  },
  hermes: {
    kind:"Client / intended operation", title:"Hermes keeps Kaylee’s seat.",
    body:`<p class="lede">The COO remains on her native Hermes interface.</p><p>Hermes should use the same attributed, project-scoped factory commands as Mage, Pi and Grok Bot. Hermes remains independently useful; no upstream fork or silent profile cutover is commissioned.</p><div class="callout">Equivalent authenticated Hermes factory operation is not proven by Mage/Pi source or by a signed-in browser.</div>${related([["coo","COO responsibilities"],["mage","Common transport"],["gaps","Remaining consumer proof"]])}`,
    sources:[[adr,"ADR-010 · Hermes and client boundaries"]]
  },
  pi: {
    kind:"Client / landed source", title:"Pi can be a client or a runtime.",
    body:`<p class="lede">Two useful roles; do not confuse their facts.</p><ul><li><strong>Executive interface:</strong> a narrow commission-relay extension carries acknowledged commissions and result references.</li><li><strong>Native worker:</strong> the standalone Pi runtime uses supported session, input, abort and observation APIs.</li></ul><p>PR237 landed scoped Pi HTTP transport. Native authentication stays at its approved consumer; no copied OAuth, transcript import or implicit model fallback.</p><div class="callout">A client lease or HTTP acknowledgment cannot prove a native message, exit or hosted turn.</div>${related([["native","Native execution"],["mage","Executive transport"]])}`,
    sources:[[source("agent-config/candidates/summon/pi-runtime/README.md"),"Pi runtime · standalone native boundary"],["https://github.com/misty-step/harness/pull/237","PR237 · scoped transport source"]]
  },
  grok: {
    kind:"Client / unresolved", title:"Grok Bot is the away-from-desk seat.",
    body:`<p class="lede">The actual bot context, not a local xAI reviewer.</p><p>The target is equivalent authenticated operation with stable command, decision and run identities. Discover the bot’s actual tools, principal mapping and private-URL reachability before promising direct HTTP controls.</p><p>AgentMail is a transport lead, not proof of the bot’s factory access. A mail relay may own delivery facts, never run state or native acknowledgment.</p><div class="callout">Maren Vane’s current contact is unresolved. Kaylee owns notification after delivery; the artifact does not wait for contact discovery.</div>${related([["mage","Shared client contract"],["gaps","What remains"]])}`,
    sources:[[adr,"ADR-010 · actual Grok Bot discovery boundary"],[glass,"Private Glass · parent and companion commitments"]]
  },
  summon: {
    kind:"Run authority / landed source", title:"Summon remembers the work.",
    body:`<p class="lede">One run owner. Several independent dimensions.</p><pre>Run phase      implementing / researching\n               awaiting_review / verified_delivery\n               interrupted\nInput delivery queued → dispatching → acknowledged\n               → answered; or uncertain\nAction holds   dispatch / verify / release\nProof binding  current candidate + coverage</pre><p>The Rust reducer owns ordered input, exclusive attempts, ambiguity, holds and revision-bound proof. A Cloudflare Durable Object per run stores the same core; the platform is an adapter, not a second factory ledger.</p><h3>Try an illustrative boundary</h3><div class="scenario-buttons" aria-label="Teaching scenarios"><button data-scenario="answered" aria-pressed="true">Answer received</button><button data-scenario="lost" aria-pressed="false">Lost reply</button><button data-scenario="steered" aria-pressed="false">New steering</button><button data-scenario="cancel" aria-pressed="false">Cancel requested</button></div><div class="state-readout" aria-live="polite" id="state-readout"></div><div class="callout">These are paper examples. No live facts are fetched, no run is submitted and nothing is saved.</div>${related([["recovery","Reconcile uncertainty"],["context","Frozen task context"],["proof","Proof freshness"]])}`,
    sources:[[protocol,"Shared Rust protocol · state and wire contracts"],[source("agent-config/candidates/summon/factory/protocol/src/lib.rs"),"Rust enums · Phase and DeliveryState"]]
  },
  native: {
    kind:"Execution authority", title:"The harness owns what actually ran.",
    body:`<p class="lede">Summon coordinates. The native harness executes and keeps its own session.</p><ul><li>Freeze harness, provider, model, effort and approved account route.</li><li>Use supported start, resume, input, abort, observe and close APIs.</li><li>Bind each receipt to the exact attempt, payload and native session.</li><li>Keep permissions in runtime tools/configuration; skills and prose cannot expand them.</li></ul><p>Pi native groundwork is landed. Historical Claude Code and Antigravity adapters are source context, not proof of current hosted compatibility. Every named route needs its own real admitted turn and recovery evidence.</p><div class="callout">Cloudflare-compatible native execution without the desktop is a target, not an observed deployment. A development VM is not its production executor.</div>${related([["cloud","Cloud execution target"],["context","Configurable context"],["recovery","Native uncertainty"]])}`,
    sources:[[source("agent-config/candidates/summon/pi-runtime/README.md"),"Pi runtime · session and exit ownership"],[adr,"ADR-010 · harness replacement and hosted scope"]]
  },
  judgments: {
    kind:"Intended integration / not shipped", title:"Jev judges. Code decides what is allowed.",
    body:`<p class="lede">Use small typed judgments instead of generated status essays.</p><details open><summary>Choice, Score and Noul</summary><ul><li><strong>Choice:</strong> select one of the code-eligible options; keep no-match when needed.</li><li><strong>Score:</strong> probability-weighted position on ordered, descriptive levels, not an arbitrary magic number.</li><li><strong>Noul:</strong> probability that a condition holds. No separate confidence; 0.5 means uncertainty, not medium intensity.</li></ul></details><p>The commissioned factory uses Jev through OpenRouter Decisions, pinned to <code>typesafe/jev-1.13</code>. Intended uses include lifecycle assessment, relevant context, eligible routing and escalation.</p><p>Bind the question, eligible candidates, policy, model and input revision. Retain typed results and actual usage, cost and latency. Low confidence, refusal and service failure need a usable conservative default or CTO escalation.</p><div class="callout">Deep live factory Jev is not shipped. Confidence is neither permission nor proof. No model call belongs on every visibility tick.</div><details><summary>Where Clef fits, and where it does not</summary><p>Clef and Clef Flash are Cloudflare judgment alternatives studied on bounded archived workflows. The retained review found no universal upgrade and did not adopt a production router. Their results do not prove live factory integration or authorize substitution.</p></details>${related([["context","Select relevant context"],["proof","Facts remain independently checked"],["gaps","Open integration boundary"]])}`,
    sources:[[adr,"ADR-010 · commissioned Jev contract"],[source("agent-config/skills/system-one/references/fleet.md"),"Fleet OpenRouter wiring"],["https://docs.typesafe.ai/primitives/choice","TypeSafe · Choice"],["https://docs.typesafe.ai/primitives/score","TypeSafe · Score"],["https://docs.typesafe.ai/primitives/noul","TypeSafe · Noul"],["https://mirrodin.tail5f5eb4.ts.net/review/harness/clef-r1.html","Private Clef review · bounded study, not adoption"]]
  },
  packets: {
    kind:"Shared read contract / landed source", title:"A packet preserves the chain, not a green badge.",
    body:`<p class="lede">Brief → authored decisions → trace → exact deliverable → independent evidence.</p><p>The shared <code>AgentRunAttemptV1</code> read contract names the owner, original reference, read time, revision/digest and freshness. <code>PacketManifestV1</code> retains immutable evidence plus original child packet references.</p><details><summary>Illustrative recursive task: tap through its children</summary><div class="tree"><strong>Parent: ship a small change</strong><details><summary>Engineer: candidate A</summary><p>Exact source and native trace are retained. Artifact proof cannot silently bless descendants.</p><details><summary>Review child: evidence bound to A</summary><p>Changing the candidate makes this proof historical, not current.</p></details><details><summary class="missing">Consumer child: source unavailable</summary><p>Keep the named gap. An incomplete parent is not recursively green.</p></details></details><details><summary>Shared dependency: one identity, two edges</summary><p>Deduplicate the node, preserve original delegation provenance. Detect cycles; page deeper work rather than hiding it after a depth cutoff.</p></details></div><p>This tree is a teaching example, not an actual fleet inventory.</p></details><ul><li>Observed-only native agents have no invented Summon phase or attempt.</li><li>Missing, failed, interrupted, stale and inaccessible outcomes remain visible and exportable.</li><li>Reopen original child archives and verify available bytes. Archive integrity is separate from current proof.</li><li>Retain authored rationale, not private chain of thought or raw secrets.</li></ul><div class="callout">Views derive from the existing owners. This page neither creates a recursive status database nor reports invented current children.</div>${related([["proof","Exact candidate proof"],["recovery","Incomplete archives"],["sources","Shared source provenance"]])}`,
    sources:[[evidence,"Standalone Rust reader · collection, export and reopen"],[source("agent-config/candidates/summon/factory/protocol/src/visibility.rs"),"Shared AgentRunAttemptV1 read contract"],[source("agent-config/candidates/summon/factory/protocol/src/evidence.rs"),"Shared PacketManifestV1 and recursive guards"],["https://github.com/misty-step/harness/pull/235","PR235 · collection and named child gaps"],["https://github.com/misty-step/harness/pull/236","PR236 · original archive freshness repair"]]
  },
  cloud: {
    kind:"Selected target / partially landed source", title:"The cloud must do more than answer HTTP.",
    body:`<p class="lede">Coordination, durable evidence and compatible native execution belong on Cloudflare in the full target.</p><pre>Authenticated, scoped clients\n             │\n       Rust Worker gateway\n             │\n    Summon / SQLite DO per run\n        │                │\n private evidence    compatible native execution\n + restore path      + provider-supported auth</pre><p>The reducer and SQLite Durable Object candidate are landed source. The deny-canary observed anonymous refusal. Private evidence storage, multi-principal admitted operation, compatible cloud execution and remote restore still need actual proof.</p><div class="callout">A denied request proves a denial. It does not prove an authenticated factory run, native cloud execution, private packet access or desktop independence.</div><details><summary>Why this shape; what can be replaced?</summary><p>Per-run DO serialization isolates ordered writes. It does not solve shared account/cash admission. Keep the reducer independent of platform storage and transport.</p><p>Local Rust + SQLite, Workflows or a conventional SQL service are replacement shapes if their real constraints justify them. They are not alternate active ledgers or permission to abandon the selected hosted target. None makes ambiguous external effects exactly-once.</p></details>${related([["native","Execution compatibility"],["recovery","Remote recovery"],["gaps","Unproven hosted boundaries"]])}`,
    sources:[[protocol,"Cloudflare candidate · transport and gateway"],[adr,"ADR-010 · target, alternatives and failure boundaries"]]
  },
  context: {
    kind:"Configurable task contract", title:"Give each task the context it needs.",
    body:`<p class="lede">A frozen task envelope, not an ever-growing universal prompt.</p><ul><li>Brief, workspace, explicit route, checks, outputs and optional source are accepted at intake.</li><li><strong>Omitted</strong> instructions or skills mean runtime defaults.</li><li><strong>Explicit empty arrays</strong> mean no selected instructions or skills.</li><li>Selected skills resolve at the runner; Jev may advise on relevance once integrated.</li></ul><div class="callout">Context selection cannot change tool permission, original acceptance, account entitlement or authority. Changing harness requires a supported session/capability handoff.</div>${related([["summon","Immutable task"],["judgments","Context judgment"],["native","Native permissions"]])}`,
    sources:[[protocol,"TaskSpec · context omission versus explicit empty"]]
  },
  proof: {
    kind:"Independent evidence", title:"Prove the candidate, not the description.",
    body:`<p class="lede">Checks, reviewers and real consumers own their evidence. Summon only binds it.</p><ul><li>Materialize the complete immutable candidate: relevant source and artifact bytes, including undeclared changes.</li><li>Exercise task-required checks and real affected journeys at that candidate.</li><li>Obtain independent exact-head review; a claimed issuer name does not authenticate independence.</li><li>Bind receipts to the original check policy, exact candidate and input/output coverage.</li></ul><p>New steering or changed delivery makes old proof historical. Missing, blocked, stale or unrelated receipts cannot verify. Hosted proof writes are defensively disabled until their receipt-source boundary is delivered.</p><details><summary>Foundations without a universal test wall</summary><p>Use each project’s actually adopted recipe, stories and catalog pin. Affected checks plus independent review precede immutable preproduction, same-byte promotion and readback. Full breadth belongs to the existing nightly/on-demand cadence, not an invented universal per-task quota.</p></details><div class="callout">Verified delivery means the artifact met its checks. GitHub, deployment and product owners still own actual release and acceptance.</div>${related([["packets","Retain the receipts"],["release","Product acceptance"],["recovery","Stale proof"]])}`,
    sources:[[protocol,"Coverage and receipt guards · remote proof refusal"],[adr,"ADR-010 · project foundations and verifier ownership"],["https://github.com/misty-step/harness/pull/236","PR236 · defensive remote-proof closure"]]
  },
  release: {
    kind:"External effect ownership", title:"Ship, then read back the real result.",
    body:`<p class="lede">The factory does not declare itself successful by writing green.</p><ol><li>CTO uses the project’s normal reviewed landing route.</li><li>Promote the same tested bytes through the authorized deployment owner.</li><li>Read back deployment identity and exercise a critical real consumer journey.</li><li>Observe operation and retain applicable recovery/rollback evidence.</li></ol><p>Summon’s kernel has no magical merge/deploy operation. A GitHub write, deployment or accepted data write is authoritative at its real owner.</p><div class="callout">Lost reply after an external effect? Reconcile that owner before retrying. A successful command exit is not proof that the intended effect happened safely.</div>${related([["proof","Before release"],["recovery","Lost-effect recovery"],["cto","Who coordinates landing"]])}`,
    sources:[[adr,"ADR-010 · release and observation guards"]]
  },
  recovery: {
    kind:"Failure boundaries", title:"Unknown is a useful answer.",
    body:`<p class="lede">Keep uncertainty visible rather than manufacturing a safe retry.</p><details open><summary>Lost acknowledgment or disconnected runtime</summary><p>A claim replay is observation only, never permission to invoke again. Reconcile exact native input, attempt, payload and session. Time, lease expiry or a missing host cannot prove unsent or terminated.</p></details><details><summary>Cancellation</summary><p>A cancel request persists intent. The runtime requests abort for the exact owned session and independently observes exit. Even an exit cannot prove a possibly dispatched effect never happened.</p></details><details><summary>Missing child or changed candidate</summary><p>Retain named missing inventory and original packet refs. Changed source makes proof stale. Failed and incomplete archives remain useful; reopening archive bytes alone does not make current proof pass.</p></details><details><summary>Storage, account or judgment failure</summary><p>Refuse before accepting work that cannot retain its outcome. Unknown cash is not zero; subscription allowance and API spend are different meters. A judgment timeout has an explicit conservative default or CTO escalation, not invented scores.</p></details><details><summary>Restore and incident ownership</summary><p>Local SQLite restart is not hosted restore/PITR. Prove remote recovery and preserve accepted writes. Existing scheduler/outcome and cause-deduplicated incident owners stay authoritative; no new factory incident ledger or notifier.</p></details>${related([["summon","Try input boundaries"],["packets","Retained incomplete evidence"],["gaps","Unresolved work"]])}`,
    sources:[[protocol,"Dispatch, cancel and reconciliation guards"],[evidence,"Integrity versus freshness"],[adr,"ADR-010 · restore and incident ownership"]]
  },
  design: {
    kind:"Intended design", title:"The destination is the full factory.",
    body:`<p class="lede">Not a local kernel, not a rollout brief and not a proxy to the desktop.</p><p>The governing commission asks for authenticated cloud coordination, evidence and compatible execution; deep Jev; equivalent Hermes, Mage, Pi and Grok Bot operation; shared admission; and recursively retained proof.</p><div class="callout">This map describes those relationships. Its target lines do not certify deployment, adoption or entitlement.</div>${related([["cloud","Selected infrastructure"],["landed","What actually landed"],["gaps","What remains"]])}`,
    sources:[[glass,"Private Glass · parent K-20261002-engineers-run-on-the-right-harness-per-p, read revision 7226"],[adr,"ADR-010 · scope precedence"]]
  },
  landed: {
    kind:"Observed GitHub merges", title:"Four landed slices. Not the finished factory.",
    body:`<ul><li><strong>PR234 · 36b1ce2:</strong> reviewed bounded coordinator/kernel and native source.</li><li><strong>PR235 · d56cdcd:</strong> source-backed collection and named missing-child evidence.</li><li><strong>PR236 · 05b5f21:</strong> defensive remote-proof refusal and original archive freshness repair.</li><li><strong>PR237 · 6569fb1:</strong> scoped Mage and Pi HTTP transports.</li></ul><p>GitHub merge identities were read on 4 October 2026. These links establish source landing only. The current source base is <code>${revision}</code>.</p><div class="callout">Source availability does not prove runtime selection, authenticated hosted operation, real recovery or product acceptance.</div>${related([["observed","Observed operation"],["gaps","Open delivery gaps"]])}`,
    sources:[234,235,236,237].map(n => [`https://github.com/misty-step/harness/pull/${n}`,`PR${n} · canonical merge and review history`])
  },
  observed: {
    kind:"Observed negative path", title:"Anonymous access was rejected.",
    body:`<p class="lede">The Cloudflare deny-canary demonstrated anonymous refusal.</p><p>This observation is retained in the governing Glass parent’s source checkpoint, read at revision 7226. Local/native source walks and archive checks have their own bounded receipts; they are not interchangeable with admitted hosted operation.</p><div class="callout">Authenticated real factory operation and desktop-independent execution are not proven. Do not infer either from the denial, an auth redirect or a successful local test.</div>${related([["cloud","Hosted target"],["proof","Receipt-source boundary"],["sources","Read the provenance"]])}`,
    sources:[[glass,"Private Glass · parent source checkpoint, revision 7226"],["https://github.com/misty-step/harness/pull/236","PR236 · defensive gateway boundary"]]
  },
  gaps: {
    kind:"Unresolved delivery boundaries", title:"Keep the remaining work visible.",
    body:`<ul><li><strong>Real hosted operation:</strong> authenticated, attributed, project-scoped client walks and refusal evidence.</li><li><strong>Desktop-independent execution:</strong> compatible native cloud turns, provider-supported authentication and recovery.</li><li><strong>Shared admission/accounting:</strong> actual subscription, resource and cash facts across runs. The Core accounting candidate remains held and unadopted; the not-started/unknown-cost issue stays with its existing writer. A newer candidate is not an accepted fix.</li><li><strong>Deep Jev:</strong> actual lifecycle/context/routing/escalation calls, failures and measured OpenRouter cost are not shipped.</li><li><strong>Evidence and effects:</strong> private retained storage, authenticated receipt sources, remote restore and same-byte promotion/observation.</li><li><strong>Client completeness:</strong> equivalent Hermes and actual Grok Bot operation, not just HTTP source.</li></ul><div class="callout">This is a dated explanation of authoritative gaps, not a new work queue. CTO owns engineering; Glass remains the commitment authority.</div><p>Maren’s contact is unresolved and Kaylee-owned. It does not block artifact publication.</p>${related([["sources","Original commitment"],["landed","Landed boundary"],["cto","Delivery owner"]])}`,
    sources:[[glass,"Private Glass · governing parent source checkpoint, revision 7226"],[adr,"ADR-010 · full acceptance and remaining boundaries"]]
  },
  sources: {
    kind:"Source, privacy and maintenance", title:"Follow the claim to its owner.",
    body:`<p class="lede">A frozen educational artifact. No polling, fake live lights or parallel authored run ledger.</p><p>Evidence was read on <strong>4 October 2026</strong>: the complete current parent and companion through Glass revision <strong>7226</strong>, and GitHub merges PR234 through PR237. CTO’s later 4 October checkpoint confirms the accounting candidate is still held and unadopted. Source links are pinned to <code>${revision}</code>.</p><p>The shared read and packet contracts own technical truth. This explainer teaches them; it does not substitute a diagram for their actual source observations. CTO maintains canonical source under <code>docs/factory-explainer/</code>.</p><details><summary>Governing items and visual policy</summary><p>Parent: <code>K-20261002-engineers-run-on-the-right-harness-per-p</code>.</p><p>Companion: <code>K-20261003-factory-architecture-stays-clear-in-a-ma</code>.</p><p>The latest companion roster and 4 October direction supersede old asks: strongly prefer Claude; GPT is allowed when Anthropic is unavailable. This artifact is authored on native Sol xhigh. The old exception request is resolved, not a hold.</p></details><details><summary>Private publication and historical evidence</summary><p>The existing Tailnet HTTPS review surface requires authorized Tailnet access. Private fleet evidence stays private; no raw transcripts, credentials or chain of thought are embedded.</p><p>Earlier rounds remain unchanged. Their historical observations and synthetic examples are references, not proof of this factory’s current completion.</p></details>${related([["landed","Canonical source merges"],["packets","The actual read contract"]])}`,
    sources:[["publication.json","Published artifact · exact source revision and asset byte manifest"],[glass,"Private Glass · current parent and companion"],[adr,"Pinned architecture source · historical visual hold is superseded"],[evidence,"Shared source-backed reader"],["https://mirrodin.tail5f5eb4.ts.net/review/summon-architectures-2026-10-03/handoff.md","Preserved architecture handoff · historical context, not current authority"],["https://mirrodin.tail5f5eb4.ts.net/review/harness/laboratory/factory.html","Preserved factory laboratory · teaching draft, not live proof"],["https://www.ascii-magic.com/","ASCII Magic · visual inspiration, no copied assets"]]
  }
};
const steps = [
  {title:"Start with the original brief.",owner:"COO → CTO → task",body:"Kaylee sets priority and acceptance. CTO supplies the scoped engineering brief. Freeze the task, original authority and optional tracker reference; never rewrite victory to fit the answer.",topic:"glass",label:"Inspect the commitment boundary"},
  {title:"Admit only what can safely run.",owner:"Summon admission + actual account owners",body:"Code checks the explicit route, current account entitlement, shared quota/resources, cash caps and action scope. Reserve room to retain the outcome. Unknown cost is not free capacity; a task intake is not launch permission.",topic:"gaps",label:"Inspect the open admission boundary"},
  {title:"Dispatch once. Observe the native facts.",owner:"Summon ⇄ native harness",body:"Persist send-intent before dispatch. The supported runtime returns an exact input/attempt/session receipt. Steering queues between turns. A lost reply is uncertainty, not a reason to blindly resend.",topic:"summon",label:"Try the run-state examples"},
  {title:"Judge what meaning requires.",owner:"Jev advice → CTO disposition",body:"Ask bounded Choice, Score or Noul questions over the relevant versioned facts. Code has already excluded forbidden choices. Confidence guides escalation, never permission. Deep live factory integration remains unshipped.",topic:"judgments",label:"Explore typed judgment"},
  {title:"Check the exact candidate.",owner:"Independent reviewer + real consumer",body:"Materialize the immutable candidate and exercise the original task’s checks. Bind independent review and consumer receipts to the exact coverage. Retain the packet and original children; missing evidence stays incomplete.",topic:"packets",label:"Drill into a recursive packet"},
  {title:"Release through the real owner.",owner:"CTO → project release owner → consumer",body:"Land reviewed source, promote the tested bytes, read back the deployed identity and walk the real product. Observe and prove recovery. A verified artifact is not deployment or product Done; Glass records acceptance from its owner.",topic:"release",label:"Inspect release and observation"}
];
const scenarios = {
  answered:{phase:"awaiting_review",delivery:"answered",hold:"release (illustrative)",proof:"missing",note:"Native answer exists. Review and consumer evidence still need to establish the artifact. A release hold does not block inspection."},
  lost:{phase:"interrupted",delivery:"uncertain",hold:"no fresh claim permitted",proof:"not established",note:"Delivery may have happened. Reconcile the exact native attempt and payload; a replayed claim is observation only."},
  steered:{phase:"implementing",delivery:"queued (new input)",hold:"none in this example",proof:"old receipt is historical",note:"New accepted steering removes current delivery. Previous evidence stays archived and cannot verify the new result."},
  cancel:{phase:"interrupted",delivery:"uncertain",hold:"cancel request retained",proof:"not established",note:"Cancellation is intent, not observed native exit. Even an observed exit cannot certify a possibly dispatched effect never occurred."}
};
const dialog = document.querySelector("#detail");
const body = document.querySelector("#detail-body");
const nav = document.querySelector(".dialog-nav");
let step = null;
let opener = null;
function openDetail(html, category, journeyStep = null) {
  if (!dialog.open) opener = document.activeElement;
  step = journeyStep;
  body.innerHTML = html;
  document.querySelector("#detail-category").textContent = category;
  nav.hidden = step === null;
  if (step !== null) {
    document.querySelector("#step-count").textContent = `${step + 1} / ${steps.length}`;
    document.querySelector("#previous-detail").disabled = step === 0;
    document.querySelector("#next-detail").disabled = step === steps.length - 1;
  }
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  // Focus content on drilldown; keep the close action first in the keyboard cycle.
  const heading = body.querySelector("h2");
  heading.tabIndex = -1;
  heading.focus({preventScroll:true});
}
function showTopic(id) {
  const topic = topics[id];
  if (!topic) return;
  openDetail(`<h2 id="detail-title">${topic.title}</h2>${topic.body}${links(topic.sources)}`,topic.kind);
  if (id === "summon") showScenario("answered");
}
function showStep(index) {
  const item = steps[index];
  if (!item) return;
  openDetail(`<h2 id="detail-title">${item.title}</h2><p class="kind observed">${item.owner}</p><p class="lede">${item.body}</p><div class="callout">Illustrative journey. This step is not a real job or a claim that its hosted boundary has shipped.</div>${related([[item.topic,item.label]])}${links([[adr,"Source · actor/guard and full-delivery map"]])}`,"Follow one task",index);
}
function showScenario(id) {
  const item = scenarios[id];
  const output = document.querySelector("#state-readout");
  if (!item || !output) return;
  for (const button of document.querySelectorAll("[data-scenario]")) button.setAttribute("aria-pressed",String(button.dataset.scenario === id));
  output.innerHTML = `<dl><dt>Run phase</dt><dd>${item.phase}</dd><dt>Input</dt><dd>${item.delivery}</dd><dt>Hold / guard</dt><dd>${item.hold}</dd><dt>Proof</dt><dd>${item.proof}</dd></dl><p>${item.note}</p>`;
}
document.addEventListener("click",event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.topic) showTopic(button.dataset.topic);
  if (button.dataset.step !== undefined) showStep(Number(button.dataset.step));
  if (button.dataset.scenario) showScenario(button.dataset.scenario);
});
document.querySelector("#close-detail").addEventListener("click",() => dialog.close());
document.querySelector("#previous-detail").addEventListener("click",() => {if (step !== null) showStep(step - 1);});
document.querySelector("#next-detail").addEventListener("click",() => {if (step !== null) showStep(step + 1);});
dialog.addEventListener("close",() => {if (opener?.isConnected) opener.focus({preventScroll:true});});
// Native dialog provides Escape, focus containment and inert background. No custom trap.
nav.hidden = true;
