import path from 'node:path';
import { home } from '../copy/home.mjs';
import { release, repositoryUrl } from './release.mjs';

// Assemble the home page from the content graph. The copy lives in
// src/copy/home.mjs; every fact here is read from this revision of the
// repository. A drift between the copy and the tree fails the build with the
// reason, instead of publishing a stale count or command.

const CORE = 'rules/core.md';
const MISTY = 'skills/misty/SKILL.md';
const TRIAL = 'docs/evals/2026-10-28-kernel-trial.md';
const HARNESSES = 'skills/misty/harnesses/';
const PARTS = ['core', 'misty', 'playbooks', 'skills', 'principles', 'oracle'];

const CARDINALS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

function fail(message) {
  throw new Error(`Home page: ${message}`);
}

function word(list, n, what) {
  if (!Number.isInteger(n) || !list[n]) fail(`no word for ${what} ${n}`);
  return list[n];
}

const cardinal = (n, what) => word(CARDINALS, n, what);
const Cardinal = (n, what) => cardinal(n, what).replace(/^./, (c) => c.toUpperCase());
const series = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const plain = (node) => node.value ?? (node.children ?? []).map(plain).join('');

function need(graph, id) {
  return graph.byId.get(id) ?? fail(`missing ${id}`);
}

// The core's list items, verbatim from the Markdown source.
function coreLines(core) {
  const list = core.ast.children.find((node) => node.type === 'list') ?? fail(`${CORE} has no list`);
  return list.children.map((item) => core.body.slice(item.position.start.offset, item.position.end.offset).trim());
}

// Field names of the misty skill's briefing contract, in source order.
function briefFields(misty) {
  const children = misty.ast.children;
  const heading = children.findIndex((node) => node.type === 'heading' && plain(node) === 'Briefing contract');
  const list = children.slice(heading + 1).find((node) => node.type === 'list');
  if (heading < 0 || !list) fail(`${MISTY} has no Briefing contract list`);
  return list.children.map((item) => {
    const strong = item.children[0]?.children?.find((node) => node.type === 'strong');
    return strong ? plain(strong).replace(/:$/, '') : fail(`${MISTY}: a briefing field has no bold name`);
  });
}

function harnesses(graph, copy) {
  const docs = graph.documents.filter((doc) => doc.id.startsWith(HARNESSES));
  const ids = docs.map((doc) => path.basename(doc.id, '.md'));
  const order = Object.keys(copy.harnesses);
  if (ids.length !== order.length || !ids.every((id) => order.includes(id))) {
    fail(`${HARNESSES} holds ${ids.join(', ')}; src/copy/home.mjs writes notes for ${order.join(', ')}`);
  }
  return order.map((id) => {
    const doc = docs[ids.indexOf(id)];
    return {
      id,
      name: doc.title.replace(/ mechanics$/, ''),
      lines: doc.command ? doc.command.value.split('\n').filter((line) => line.trim()) : [],
      note: copy.harnesses[id],
      source: { label: doc.id, href: doc.url },
    };
  });
}

let page;
export function getHome(graph) {
  return page ??= build(graph);
}

function build(graph) {
  const core = need(graph, CORE);
  const misty = need(graph, MISTY);
  const trial = need(graph, TRIAL);
  const lines = coreLines(core);
  const headline = home.hero({ coreLines: '', headlineLine: '', commandHarnesses: '' }).headline;
  const opening = headline.replace(/\.$/, '');
  const at = lines.findIndex((line) => line.replace(/^-\s+/, '').startsWith(opening));
  if (at < 0) fail(`no line of ${CORE} starts with "${opening}"`);

  const installCopy = home.install({ inProgress: '' });
  const tabs = harnesses(graph, installCopy);
  const withCommands = tabs.filter((tab) => tab.lines.length);
  const facts = {
    coreLines: cardinal(lines.length, 'core lines'),
    CoreLines: Cardinal(lines.length, 'core lines'),
    headlineLine: word(ORDINALS, at + 1, 'core line'),
    commandHarnesses: series(withCommands.map((tab) => tab.name)),
  };

  const playbookIds = [...misty.outboundLinks].filter((id) => id.startsWith('skills/misty/playbooks/'));
  const playbooks = graph.documents.filter((doc) => doc.kind === 'Playbooks');
  if (playbookIds.length !== playbooks.length) fail(`${MISTY} routes to ${playbookIds.length} playbooks; the tree has ${playbooks.length}`);
  const playbookNames = playbookIds.map((id, index) => {
    const title = need(graph, id).title;
    return index ? title.replace(/^./, (c) => c.toLowerCase()) : title;
  });
  const skills = graph.documents.filter((doc) => doc.kind === 'Skills');
  const principles = graph.documents.filter((doc) => doc.kind === 'Principles');
  for (const id of ['skills/research/SKILL.md', 'skills/security-audit/SKILL.md', 'skills/principle-one-home-per-fact/SKILL.md']) need(graph, id);

  const methodCopy = home.method({ Parts: Cardinal(PARTS.length, 'parts'), playbooks: cardinal(playbooks.length, 'playbooks') });
  const contract = misty.headings.find((heading) => heading.label === 'Briefing contract') ?? fail(`${MISTY} has no Briefing contract heading`);
  const nodes = [
    { id: 'core', label: 'Core', href: core.url },
    { id: 'misty', label: 'Misty', href: misty.url },
    { id: 'playbooks', label: 'Playbooks', count: playbooks.length, href: '/library/?section=Playbooks', body: methodCopy.nodes.playbooks(series(playbookNames)) },
    { id: 'skills', label: 'Skills', count: skills.length, href: '/library/?section=Skills' },
    { id: 'principles', label: 'Principles', count: principles.length, href: '/library/?section=Principles' },
    { id: 'oracle', label: 'Oracle', href: `${misty.url}#${contract.id}` },
  ].map((node) => ({ ...node, body: node.body ?? methodCopy.nodes[node.id] }));

  const fields = briefFields(misty);
  const briefCopy = home.brief({ fields: cardinal(fields.length, 'brief fields') });
  const written = Object.keys(briefCopy.fields);
  if (fields.join('|') !== written.join('|')) fail(`${MISTY} lists the brief fields ${fields.join(', ')}; the copy writes ${written.join(', ')}`);
  if (!misty.body.includes('A brief with no Oracle')) fail(`${MISTY} no longer returns a brief without an Oracle`);

  const round = trial.data;
  const evidenceCopy = home.evidence({ Tasks: Cardinal(round.taskCount, 'tasks'), tasks: cardinal(round.taskCount, 'tasks'), limits: cardinal(round.limits.length, 'limits') });
  if (!round.arms.some((arm) => arm.label === evidenceCopy.highlight)) fail(`${TRIAL} has no arm "${evidenceCopy.highlight}"`);
  const chapters = graph.documents.filter((doc) => /^docs\/guide\/\d+-[^/]+\.md$/.test(doc.id)).length;

  return {
    title: home.title,
    nav: home.nav,
    navCta: home.navCta,
    hero: home.hero(facts),
    sections: {
      core: { ...home.core(facts), lines, source: { label: CORE, href: core.url }, commit: release.commit.slice(0, 7), commitUrl: core.source.blobUrl },
      method: { title: methodCopy.title, intro: methodCopy.intro, nodes },
      brief: { title: briefCopy.title, intro: briefCopy.intro, items: fields.map((title) => ({ title, body: briefCopy.fields[title] })) },
      evidence: {
        ...evidenceCopy,
        rows: round.arms.map((arm) => ({ id: arm.id, label: arm.label, passed: arm.oraclePassed, total: arm.oracleTotal, highlight: arm.label === evidenceCopy.highlight })),
        limits: round.limits,
        href: trial.url,
      },
      install: { ...home.install({ inProgress: series(withCommands.filter((tab) => tab.id !== 'omp').map((tab) => tab.name)) }), tabs },
      read: home.read({ chapters: cardinal(chapters, 'guide chapters') }),
    },
    footer: home.footer,
    repositoryUrl,
  };
}
