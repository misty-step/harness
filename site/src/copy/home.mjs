// The home page's words: the r2-cut stack copy from the Misty Step brand
// configurator (misty-step/aesthetic, brand/configurator/options/copy/r2-cut), moved here
// as this site's single copy home. Facts are not written here. src/lib/home.mjs
// reads the core lines, install commands, counts and trial numbers from the
// repository and passes them in as `facts`; spelled counts arrive as words.

export const home = {
  title: 'mistystack',
  nav: [
    { label: 'The core', href: '#core' },
    { label: 'The parts', href: '#method' },
    { label: 'Evidence', href: '#evidence' },
    { label: 'Guide', href: '/guide/' },
  ],
  navCta: { label: 'Install', href: '#install' },
  hero: (facts) => ({
    headline: 'Before work, name the check.',
    sub: `mistystack is Misty Step's open method for coding agents. Its core is ${facts.coreLines} lines long and loads in every session; the ${facts.headlineLine} line starts with this headline.`,
    primary: { label: 'Install for your harness', href: '#install' },
    secondary: { label: `Read all ${facts.coreLines} lines`, href: '#core' },
    proof: `Install commands for ${facts.commandHarnesses}.`,
  }),
  core: (facts) => ({
    title: `${facts.CoreLines} lines. Every session.`,
    caption: 'The whole always-on core, verbatim.',
    trialNote: 'The trial evaluated an earlier snapshot.',
  }),
  method: (facts) => ({
    title: `${facts.Parts} parts. One always on.`,
    intro: `Only the core loads every time. The misty skill reads each task and routes it to one of ${facts.playbooks} playbooks or a specialist skill, and principles load only when their trigger applies.`,
    // Node order and bodies. Labels and counts come from the repository.
    nodes: {
      core: 'The always-on routing and guardrails.',
      misty: 'Reads the task and chooses the playbook and skills.',
      playbooks: (list) => `${list}.`,
      skills: 'Specialists such as research and security audit, loaded when a task needs one.',
      principles: 'Rules of judgment such as one home per fact, read only when they apply.',
      oracle: 'A check outside the agent that can disprove completion, named before work starts.',
    },
  }),
  brief: (facts) => ({
    title: 'Every handoff gets a brief.',
    intro: `When work goes to a subagent, the misty skill lists ${facts.fields} fields for its brief. A brief with no Oracle goes back to shaping.`,
    // One body per briefing-contract field in skills/misty/SKILL.md, in its order.
    fields: {
      'Outcome and why': 'The change the consumer gets, with links to its sources.',
      Terms: "The project's own words for the work, from its DOMAIN.md.",
      'Raw material': 'The failing run, logs, data or source to start from, rather than a summary of them.',
      Oracle: 'The check outside the worker that proves the result, with the exact command.',
      'Scope and Keep': 'The change this worker owns, and the behavior that must remain.',
      Effort: 'How much judgment the unit needs.',
    },
  }),
  evidence: (facts) => ({
    title: `${facts.Tasks} tasks, one run each.`,
    intro: `Reported artifact Oracle passes across ${facts.tasks} replayed tasks per arm. Not a general superiority claim. The ${facts.limits} limits below belong with these numbers wherever they are quoted.`,
    highlight: 'Mistystack kernel',
    link: 'Read the trial record and limitations',
  }),
  install: (facts) => ({
    title: 'Shipped for OMP first.',
    intro: `The ${facts.inProgress} adapters are in progress (#591). Their commands are here too, copied from each harness's reference file in the repository.`,
    issue: { label: '#591', href: 'https://github.com/misty-step/mistystack/issues/591' },
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Select the command to copy',
    // Tab order and one note per harness reference in skills/misty/harnesses/.
    harnesses: {
      omp: 'Start a fresh OMP session.',
      claude: 'Start a fresh session after installing.',
      codex: 'Review and trust the native SessionStart hook. Rigor agents are installed separately.',
      pi: 'Rigor runs inline; pi has no native subagent mechanism.',
      'grok-bot': 'No public install command. Follow the runtime-specific self-install and fresh-session proof brief. Grok Build CLI is not a target.',
    },
    source: 'Source:',
  }),
  read: (facts) => ({
    title: 'Done means the check passes.',
    body: `Every part of the method is a Markdown file in a public, MIT-licensed repository. The guide walks through it in ${facts.chapters} chapters.`,
    primary: { label: 'Read the guide', href: '/guide/' },
    secondary: { label: 'Browse the source', href: 'https://github.com/misty-step/mistystack' },
  }),
  footer: {
    line: "mistystack is Misty Step's engineering method, MIT licensed.",
  },
};
