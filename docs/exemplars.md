# Exemplars

Favourite sources we learned from. An [Exemplar](../DOMAIN.md#terms) is a person, codebase or piece of writing whose perspective we deliberately channel in our workflows, skills, processes, applications and designs. Products show those perspectives in use.

Add an entry with a primary-source link, what to channel and any skill where it already appears. These are selected lenses, not blanket endorsements or requirements to copy a stack. Skills cite their sources in `metadata.source`; adapted material and its licences are recorded in [ATTRIBUTION.md](../ATTRIBUTION.md). None of these upstream packs or tools is installed by mistystack; links are reading material, not dependencies. Entries without an adoption note are references to study.

## People

- **[Jacob Sansbury — Written for Readers That Didn't Exist Yet](https://www.workbyjacob.com/thoughts/written-for-readers-that-didnt-exist-yet):** a record-first company, whole-outcome ownership, one mind builds while another attacks, and mechanical authority rather than inferred permission.
  Channel [recompiling the company from the vision](https://x.com/jsnnsa/status/2115671437575168084), not mandatory monthly rewrites; [How We Build 2.0](https://www.workbyjacob.com/thoughts/how-we-build-2-0) offers four materially different variants so people can discover what they want. Method adoption is proposed, not yet implemented.
- [Linus Torvalds — Git data-design email](https://lwn.net/Articles/193245/): design around data and their relationships; remove special cases through representation. Already in `principle-deep-modules` through his good-taste lens.
- [John Ousterhout — the Ousterhout–Martin written debate](https://github.com/johnousterhout/aposd-vs-clean-code/), alongside [A Philosophy of Software Design](https://web.stanford.edu/~ouster/cgi-bin/book.php): deep modules and small interfaces. Already in `principle-deep-modules`; compare the disagreement rather than flattening it.
- [John Carmack — On Inlined Code, with his 2014 correction](https://number-none.com/blow/john_carmack_on_inlined_code.html): visible sequential execution, explicit dependencies and less unexpected state mutation.
- [Elon Musk — original Starbase tour interview](https://www.youtube.com/watch?v=t705r8ICkRw): question owned requirements, delete, simplify, accelerate, then automate; the manufacturing examples are not a software-wide instruction to delete tests.
- [Rich Hickey — Simple Made Easy](https://www.youtube.com/watch?v=LKtk3HCgTa8): reduce entanglement, distinguish simple from familiar and represent information as data.
- [Lauren Tan / poteto — pstack introduction](https://github.com/cursor/plugins/blob/main/pstack/README.md) and [skills](https://github.com/cursor/plugins/tree/main/pstack/skills): domain-shaped types, outside proof and structural lessons. Already in `misty`, principle leaves, `grill`, `design`, `judge`, `research`, `test-audit` and other adapted skills.
- [Kent C. Dodds — The Testing Trophy and Testing Classifications](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications): confidence from use-shaped tests and the right boundary, not a universal ratio.
- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html): keep business policy independent of framework and persistence; exchange simple structures across boundaries.
- [Boris Cherny — Claude Code best practices](https://www.anthropic.com/research/claude-code-best-practices): reusable workflows, independent challenge and real verification feedback. This authored historical essay is no longer maintained; use current documentation for commands.
- [Peter Steinberger — Shipping at Inference-Speed](https://steipete.me/posts/2025/shipping-at-inference-speed): scriptable CLIs that let agents act and verify, with human architectural judgment; his solo workflow is not a universal concurrency policy.

## Codebases

- [pstack — Lauren Tan](https://github.com/cursor/plugins/tree/main/pstack): one mode, small principles, playbooks, setup and a human guide. Already in `misty`, principle leaves, setup, writing, verification, design, grill, judge, research and test-audit.
- [Matt Pocock's skills](https://github.com/mattpocock/skills): shaping, domain language and instructions agents can follow. Already in `grill`, `agent-design`, `research` and `writing`.
- [Emil Kowalski's skills](https://github.com/emilkowalski/skills): design engineering and purposeful motion. Already in `design`.
- [Impeccable — Paul Bakaus](https://github.com/pbakaus/impeccable): interface critique, accessibility and polish. Already in `design`.
- [Taste — Leon Lin](https://github.com/Leonxlnx/taste-skill): deliberate visual choices rather than generic output.
- [Hallmark — Nutlope](https://github.com/Nutlope/hallmark): coherent design direction for coding agents.
- [Kody — Kent C. Dodds](https://github.com/kentcdodds/kody): an agent workflow to study; FSL-1.1 reference only, no copied material.
- [Nico Bailon, skill-diet](https://github.com/nicobailon/skill-diet): compare instructions with both their earlier form and no skill. Already in `principle-skill-diet` and `agent-design`.
- [Entire](https://entire.com/blog/the-entire-cli-how-it-works-and-where-its-headed): durable checkpoint provenance that links code, agent sessions and attribution to commits instead of copying transcripts into every downstream artifact.
- [GitHub Spec Kit](https://github.github.com/spec-kit/): portable, agent-independent specifications and acceptance contracts.
- [Release Please](https://github.com/googleapis/release-please/): let one evolving release PR become the tagged release record; package publication remains a separate responsibility.
- [Remotion](https://www.remotion.dev/docs/ai/coding-agents): reproducible video from code and structured evidence, with a documented agent workflow.
- [Epic Stack](https://github.com/epicweb-dev/epic-stack): a coherent opinionated reference that reduces repeated setup decisions and unnecessary services; study the current repository, not an old stack list.
- [git-ai](https://github.com/git-ai-project/git-ai): durable line-level attribution linked to agents, models and prompts; attribution is not a quality verdict.

## Writing

- [Felix Rieseberg, “How to be more ambitious”](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/): deepen the method rather than inflate the scope. Already in `principle-deeper-not-bigger`.
- [Martin Gratzer on slices](https://x.com/mgratzer/status/2114726996869595265): useful vertical slices with independent review and a risk check. Already in `principle-vertical-slices`.
- [Kent C. Dodds, “Write tests. Not too many. Mostly integration.”](https://kentcdodds.com/blog/write-tests): confidence through behavior across real boundaries; Dodds credits Guillermo Rauch for the original slogan.
- [Linus Torvalds, Linux kernel coding style](https://github.com/torvalds/linux/blob/master/Documentation/process/coding-style.rst): simple code, clear ownership and maintainable interfaces.
- [Jakub Krehel, “Less is more, more or less”](https://jakub.kr/writing/less-is-more): subtraction follows understanding.
- [Agent Trace specification](https://agent-trace.dev/): interoperable human/AI contribution provenance with revision identity and conversation links; storage is implementation-defined and attribution does not prove quality.

## Products

- [TypeSafe](https://docs.typesafe.ai/): typed judgments as composable program primitives.
- [Linear](https://linear.app/docs/initiatives), [updates](https://linear.app/docs/initiative-and-project-updates) and [agents](https://linear.app/docs/agents-in-linear): steer by objectives, evidence and decisions, with execution records underneath.
- [Kiro](https://kiro.dev/docs/specs/) and [requirement analysis](https://kiro.dev/docs/specs/analyze-requirements/): reconsider contradictions, ambiguity and missing cases when specifications change.
- [Granola](https://docs.granola.ai/help-center/sharing/integrations/mcp): directly addressable meeting evidence and quotations under existing access scopes.
- [PostHog](https://posthog.com/docs/product-analytics/funnels) and [AI traces](https://posthog.com/docs/ai-observability): connect real user outcomes to behavior and agent costs; bounded path exploration is not funnel conversion measurement.
