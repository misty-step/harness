# Factory field guide

Canonical static educational artifact; CTO owns maintenance and landing. This is
not a live dashboard, another status ledger or a factory control surface. No
installer, runtime, Core source or prior review artifact is changed.

Open `index.html` directly or serve this directory with an ordinary static HTTP
server. The HTML/CSS/JS have no dependencies, external fonts, telemetry, model
calls, storage, polling or live controls. Native `<dialog>` provides modal
keyboard behavior; ordinary buttons and `<details>` provide touch disclosure.
The overview remains readable without JavaScript. Tokyo Night/Omarchy colors,
sharp edges and original character art supply the visual language. There is no
animation, including with reduced motion enabled.

## Evidence boundary

The page distinguishes intended design, landed source, bounded observed
operation and unresolved gaps. Architecture links pin the source base to
`6569fb1c3565137b043a90f91d54dad456d3ad3e`; PR234 through PR237 establish landing,
not deployed operation. The current parent and companion were read completely
through Glass revision 7226 on 4 October 2026, followed by CTO's same-day source
checkpoint. The accounting candidate remains held/unadopted, deep factory Jev
is not shipped, and anonymous denial proves neither admitted operation nor
cloud-native execution. Later observations require a new reviewed round, not
an edited historical receipt or an automatic status update.

Public source contains only the teaching map and bounded summaries. It includes
no private receipt bodies, transcripts, account/principal/resource identities,
credentials, native session paths or private scratch evidence index. Links
lead to public exact source/PRs or the existing private commitment/review
surfaces. Preserve those surfaces' original access boundary; no Funnel/public
hosting or copied authentication is authorized.

## Real-browser walk

Use existing Playwright and axe-core installations, never an implicit `npx`
download. Run one browser with sequential states:

```sh
python3 -m http.server 18774 --bind 127.0.0.1 --directory docs/factory-explainer
PLAYWRIGHT_MODULE=/absolute/existing/node_modules/playwright \
AXE_SCRIPT=/absolute/existing/node_modules/axe-core/axe.min.js \
node docs/factory-explainer/walk.mjs http://127.0.0.1:18774/ /absolute/run-scoped/evidence
review-check --screenshot /absolute/run-scoped/first.png docs/factory-explainer/index.html
```

The walk exercises rendered topic disclosure and checks same-origin Sources
links return 200 with the expected publication section. It covers four viewports
(1280×640, 390×844, 320×740, 768×1024), 44px touch heights, all six journey
steps, recursive missing-child drilldown, input scenarios, Escape/focus return,
background inertness, reduced motion, overflow, browser errors and WCAG axe
checks. It captures each desktop/phone topic and emits an execution receipt.
Touch is emulated in real Chromium, not a claim of physical-handset testing.
Screenshots and automated checks do not establish an independent visual verdict
or any factory backend effect. The normal root gate is unchanged; this browser
walk is explicit, not a hidden dependency of shared/installer checks.

## Private immutable publication

After independent actual-rendered review and CTO-coordinated exact-head
review/green CI/normal landing, publish the three static assets (`index.html`,
`factory.css`, `factory.js`) **and this `README.md` as a supporting document** into
a **new** round under the existing authorized Tailnet `/review/` surface. Keep
the three runtime assets distinct from the supporting document. The page's
Sources disclosure links here, so omitting the README breaks that navigation.
Do not overwrite old rounds. Include `publication.json` with the actual landed
source commit, the three runtime asset SHA-256 values, the supporting README's
SHA-256, and canonical source URL; this is an artifact-byte receipt, not factory
status. Preserve browser/reviewer evidence privately and link its bounded
receipt hashes from the manifest. Do not publish private factory receipts or
transcripts.

Exercise the final HTTPS URL in the real browser and fetch that exact URL from
a separate authorized Tailnet machine, comparing returned bytes and manifest.
Report URL, landed revision, actual rendered verdict, browser proof and remaining
risks to CTO/Kaylee. Hosting the explainer is not delivery of the full factory.
Maren's contact/notification is Kaylee-owned and does not block publication.
