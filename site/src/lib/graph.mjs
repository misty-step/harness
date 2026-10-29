import path from 'node:path';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import { parseDocument } from 'yaml';
import { blobUrl, encodePath, release, repoRoot, repositoryUrl } from './release.mjs';
import { historicalSources } from './historical-sources.mjs';

const markdown = unified().use(remarkParse).use(remarkGfm);
const toHtml = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
const stringify = unified().use(rehypeStringify);
const text = (node) => node.value ?? (node.children ?? []).map(text).join('');
const element = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });
const literal = (value) => ({ type: 'text', value });
const rootRoutes = {
  'README.md': '/repository/', 'DOMAIN.md': '/domain/', 'USER_STORIES.md': '/stories/',
  'ATTRIBUTION.md': '/attribution/', 'CHANGELOG.md': '/changelog/',
  'CONTRIBUTING.md': '/contributing/', 'FOUNDATIONS.md': '/foundations/', 'SPEC.md': '/spec/',
  'rules/core.md': '/library/core/', 'docs/references.md': '/references/',
  'docs/decisions/index.md': '/decisions/', 'docs/guide/README.md': '/guide/',
  'docs/guide/01-install-and-setup.md': '/install/',
  'skills/foundation/checklist.md': '/foundation/', 'skills/misty/SKILL.md': '/library/misty/',
};

function routeFor(id, data) {
  if (rootRoutes[id]) return rootRoutes[id];
  if (/^docs\/guide\/\d+-/.test(id)) return `/guide/${path.basename(id).replace(/^\d+-|\.md$/g, '')}/`;
  if (id.startsWith('docs/decisions/')) return `/${id.slice(5, -3)}/`;
  if (id.startsWith('docs/evals/')) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(data.id ?? '')) throw new Error(`${id}: eval id is required and must be a URL slug`);
    return `/evals/${data.id}/`;
  }
  if (id.startsWith('skills/misty/harnesses/')) return `/install/${path.basename(id, '.md')}/`;
  if (id.startsWith('skills/misty/playbooks/')) return `/library/playbooks/${path.basename(id, '.md')}/`;
  const skill = /^skills\/([^/]+)\/(.+)\.md$/.exec(id);
  if (skill) {
    if (skill[1].startsWith('principle-') && skill[2] === 'SKILL') return `/library/principles/${skill[1].slice(10)}/`;
    return `/library/skills/${skill[1]}/${skill[2] === 'SKILL' ? '' : `${skill[2]}/`}`;
  }
  return `/${id.replace(/\.md$/, '')}/`;
}

function kindFor(id) {
  if (id === 'rules/core.md') return 'Core';
  if (id === 'skills/misty/SKILL.md') return 'Mode';
  if (/^skills\/principle-[^/]+\/SKILL\.md$/.test(id)) return 'Principles';
  if (/^skills\/[^/]+\/SKILL\.md$/.test(id)) return 'Skills';
  if (id.startsWith('skills/misty/harnesses/')) return 'Install';
  if (id.startsWith('skills/misty/playbooks/')) return 'Playbooks';
  if (id === 'skills/foundation/checklist.md') return 'Foundation';
  if (id.startsWith('skills/')) return 'Supporting documents';
  if (id.startsWith('docs/evals/')) return 'Evals';
  if (id.startsWith('docs/decisions/')) return 'Decisions';
  if (id.startsWith('docs/guide/')) return id.includes('01-install') ? 'Install' : 'Guide';
  return 'About';
}

function parseSource(id, raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return { body: raw, data: {}, offset: 0 };
  const yaml = parseDocument(match[1]);
  if (yaml.errors.length) throw new Error(`${id}: frontmatter: ${yaml.errors[0].message}`);
  const data = yaml.toJS();
  if (id.endsWith('/SKILL.md')) {
    const date = yaml.getIn(['metadata', 'sunset'], true);
    if (date?.type === 'PLAIN' && /^\d{4}-\d{2}-\d{2}/.test(String(date.value))) {
      throw new Error(`${id}: metadata.sunset must be a quoted string, not a YAML date`);
    }
  }
  return { body: raw.slice(match[0].length), data, offset: match[0].split('\n').length - 1 };
}

function validateMetadata(doc) {
  if (doc.id.endsWith('/SKILL.md')) {
    const { data } = doc;
    for (const key of ['name', 'description']) {
      if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`${doc.id}: ${key} must be a nonempty string`);
    }
    if (data.name !== doc.id.split('/')[1]) throw new Error(`${doc.id}: name must match its installed directory`);
    for (const key of ['owner', 'prevents', 'source', 'sunset']) {
      if (typeof data.metadata?.[key] !== 'string' || !data.metadata[key].trim()) throw new Error(`${doc.id}: metadata.${key} must be a nonempty string`);
    }
    const review = new Date(`${data.metadata.sunset}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.metadata.sunset) || Number.isNaN(review.valueOf()) || review.toISOString().slice(0, 10) !== data.metadata.sunset) {
      throw new Error(`${doc.id}: metadata.sunset must be an ISO review date`);
    }
    if (data['disable-model-invocation'] !== undefined && typeof data['disable-model-invocation'] !== 'boolean') {
      throw new Error(`${doc.id}: disable-model-invocation must be a boolean`);
    }
    doc.skill = { name: data.name, description: data.description, ...data.metadata, disableModelInvocation: data['disable-model-invocation'] === true };
  }
  if (doc.kind === 'Evals') {
    for (const key of ['id', 'date', 'title', 'status', 'sourceRevision', 'harness', 'model', 'thinking', 'judge']) {
      if (typeof doc.data[key] !== 'string' || !doc.data[key].trim()) throw new Error(`${doc.id}: eval ${key} is required as a string`);
    }
    if (!Number.isInteger(doc.data.taskCount) || doc.data.taskCount < 1) throw new Error(`${doc.id}: taskCount must be positive`);
    if (!Array.isArray(doc.data.arms) || doc.data.arms.length < 2) throw new Error(`${doc.id}: eval arms are required`);
    if (new Set(doc.data.arms.map((arm) => arm.id)).size !== doc.data.arms.length) throw new Error(`${doc.id}:1: duplicate eval arm id`);
    for (const arm of doc.data.arms) {
      if (!arm.id || !arm.label || !Number.isInteger(arm.oraclePassed) || !Number.isInteger(arm.oracleTotal) || arm.oracleTotal !== doc.data.taskCount || arm.oraclePassed < 0 || arm.oraclePassed > arm.oracleTotal) {
        throw new Error(`${doc.id}: invalid arm or Oracle denominator`);
      }
      for (const key of ['meanBlindScore', 'tokens']) if (typeof arm[key] !== 'number' || !Number.isFinite(arm[key])) throw new Error(`${doc.id}: arm ${key} must be a finite number`);
    }
    if (!Array.isArray(doc.data.limits) || !doc.data.limits.length || !doc.data.limits.every((limit) => typeof limit === 'string' && limit.trim()) || !Array.isArray(doc.data.evidence) || !doc.data.evidence.length) throw new Error(`${doc.id}:1: eval limits and evidence are required`);
    for (const item of doc.data.evidence) {
      if (!/^https:\/\//.test(item.url ?? '') || typeof item.label !== 'string' || !item.label.trim() || !['public', 'private', 'unavailable'].includes(item.visibility)) throw new Error(`${doc.id}:1: invalid evidence URL, label or visibility`);
    }
  }
}

function prepareHeadings(doc) {
  const slugger = new GithubSlugger();
  const ids = new Set();
  visit(doc.hast, 'element', (node) => {
    if (!node.properties?.id) return;
    const id = String(node.properties.id);
    if (ids.has(id)) throw new Error(`${doc.id}:${(node.position?.start.line ?? 1) + doc.offset}: duplicate id #${id}`);
    ids.add(id);
  });
  let foundTitle = false;
  visit(doc.hast, 'element', (node) => {
    if (!/^h[1-6]$/.test(node.tagName)) return;
    const label = text(node);
    let id = node.properties.id;
    if (!id) {
      do { id = slugger.slug(label); } while (ids.has(id));
      ids.add(id);
      node.properties.id = id;
    }
    const story = /^US-\d+\b/i.exec(label)?.[0].toLowerCase();
    if (story && !ids.has(story)) {
      node.children.unshift(element('span', { id: story }, []));
      ids.add(story);
    }
    const isTitle = node.tagName === 'h1' && !foundTitle;
    if (isTitle) foundTitle = true;
    doc.headings.push({ id, label, depth: Number(node.tagName[1]), sourceLine: (node.position?.start.line ?? 1) + doc.offset });
    if (!isTitle) node.children.push(element('a', { href: `#${id}`, className: ['heading-anchor'], ariaLabel: `Link to section: ${label}` }, [literal('#')]));
  });
  doc.ids = ids;
  const first = doc.hast.children.findIndex((node) => node.type === 'element' && node.tagName === 'h1');
  if (first !== -1) doc.hast.children.splice(first, 1); // The layout renders this exact H1 and its id.
}

function sourceFailure(doc, node, message) {
  throw new Error(`${doc.id}:${(node.position?.start.line ?? 1) + doc.offset}: ${message}`);
}

function resolveTarget(doc, href, node, graph, image = false) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
    if (!href.startsWith(`${release.canonical}/`)) return href;
    href = href.slice(release.canonical.length);
  }
  const hashAt = href.indexOf('#');
  const fragment = hashAt < 0 ? '' : href.slice(hashAt + 1);
  const beforeHash = hashAt < 0 ? href : href.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt < 0 ? '' : beforeHash.slice(queryAt);
  let target = decodeURIComponent(queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt));
  let targetDoc;
  if (!target) targetDoc = doc;
  else if (target.startsWith('/')) {
    targetDoc = graph.byUrl.get(target.endsWith('/') ? target : `${target}/`);
    if (!targetDoc && graph.specialRoutes.has(target)) {
      if (fragment && !graph.specialRoutes.get(target).has(decodeURIComponent(fragment))) sourceFailure(doc, node, `missing fragment ${href}`);
      return `${target}${query}${fragment ? `#${fragment}` : ''}`;
    }
    if (!targetDoc) target = target.slice(1);
  } else target = path.posix.normalize(path.posix.join(path.posix.dirname(doc.id), target));
  if (!targetDoc) {
    if (target === '..' || target.startsWith('../') || path.isAbsolute(target)) sourceFailure(doc, node, `link escapes repository: ${href}`);
    let absolute = path.join(repoRoot, target);
    const historical = ['Historical', 'Workstation'].includes(doc.decision?.group) || doc.id.startsWith('docs/postmortems/');
    const archive = historical && (historicalSources.get(`${target}#${decodeURIComponent(fragment)}`) || (!existsSync(absolute) && historicalSources.get(target)));
    if (archive) {
      if (fragment && !archive.fragments.includes(decodeURIComponent(fragment))) sourceFailure(doc, node, `unknown archived fragment: ${href}`);
      node.children.push(literal(` (archived source ${archive.commit.slice(0, 7)})`));
      return `${repositoryUrl}/blob/${archive.commit}/${encodePath(target)}${query}${fragment ? `#${fragment}` : ''}`;
    }
    if (!existsSync(absolute)) sourceFailure(doc, node, `missing internal target: ${href} (${target})`);
    if (!realpathSync(absolute).startsWith(`${realpathSync(repoRoot)}${path.sep}`) && realpathSync(absolute) !== realpathSync(repoRoot)) sourceFailure(doc, node, `link escapes repository: ${href}`);
    if (statSync(absolute).isDirectory()) {
      const child = ['README.md', 'index.md', 'SKILL.md'].find((name) => existsSync(path.join(absolute, name)));
      if (!child) return `${repositoryUrl}/tree/${release.commit}/${encodePath(target)}${fragment ? `#${fragment}` : ''}`;
      target = path.posix.join(target, child);
      absolute = path.join(repoRoot, target);
    }
    targetDoc = graph.byId.get(target);
    if (!targetDoc) {
      if (fragment && target.endsWith('.md')) {
        const parsed = parseSource(target, readFileSync(absolute, 'utf8'));
        const slugger = new GithubSlugger();
        const anchors = new Set();
        visit(markdown.parse(parsed.body), (entry) => {
          if (entry.type === 'heading') anchors.add(slugger.slug(text(entry)));
          if (entry.type === 'html') for (const match of entry.value.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
        });
        if (!anchors.has(decodeURIComponent(fragment))) sourceFailure(doc, node, `missing source fragment: ${href}`);
      }
      return image ? `https://raw.githubusercontent.com/misty-step/mistystack/${release.commit}/${encodePath(target)}` : `${blobUrl(target)}${query}${fragment ? `#${fragment}` : ''}`;
    }
  }
  if (fragment && !targetDoc.ids.has(decodeURIComponent(fragment))) sourceFailure(doc, node, `missing fragment: ${href} in ${targetDoc.id}`);
  if (targetDoc.id !== doc.id) doc.outboundLinks.add(targetDoc.id);
  return `${targetDoc.url}${query}${fragment ? `#${fragment}` : ''}`;
}

function decorateHtml(doc, graph) {
  visit(doc.hast, 'element', (node) => {
    const properties = node.properties ?? {};
    if (node.tagName === 'a' && typeof properties.href === 'string') {
      if (properties.href.startsWith('omp://')) {
        node.children.push(literal(' (Open in OMP)'));
        properties.title = 'Open in OMP';
      } else properties.href = resolveTarget(doc, properties.href, node, graph);
    }
    if (node.tagName === 'img' && typeof properties.src === 'string') properties.src = resolveTarget(doc, properties.src, node, graph, true);
    if (node.tagName === 'pre') {
      properties.tabIndex = 0;
      properties.role = 'region';
      properties.ariaLabel = 'Code example, scroll horizontally if needed';
    }
  });
  visit(doc.hast, 'element', (node, index, parent) => {
    if (node.tagName !== 'table' || !parent || parent.properties?.className?.includes('table-scroll')) return;
    parent.children[index] = element('div', { className: ['table-scroll'], tabIndex: 0, role: 'region', ariaLabel: 'Table, scroll horizontally if needed' }, [node]);
  });
  doc.html = stringify.stringify(doc.hast);
}

function assignDecisionGroups(graph) {
  const decisionIndex = graph.byId.get('docs/decisions/index.md');
  let group = 'Current';
  let order = 0;
  visit(decisionIndex.ast, (node) => {
    if (node.type === 'heading' && node.depth === 2) group = text(node).replace(' decisions', '');
    if (node.type !== 'link') return;
    const id = path.posix.normalize(path.posix.join('docs/decisions', node.url));
    const decision = graph.byId.get(id);
    if (decision?.kind === 'Decisions') { decision.decision.group = group; decision.order = order++; }
  });
}

function deriveRelationships(graph) {
  const decisionIndex = graph.byId.get('docs/decisions/index.md');
  for (const doc of graph.documents) {
    if (doc.kind === 'Decisions' && doc !== decisionIndex) {
      visit(doc.ast, 'paragraph', (paragraph) => {
        const context = text(paragraph);
        if (!/supersed|reverses/i.test(context)) return;
        visit(paragraph, 'link', (link) => {
          const id = path.posix.normalize(path.posix.join(path.posix.dirname(doc.id), link.url.split('#')[0]));
          const previous = graph.byId.get(id);
          if (previous?.decision && previous.id !== doc.id && !previous.supersession.some((item) => item.id === doc.id)) previous.supersession.push({ id: doc.id, context });
        });
      });
    }
    if (doc.parentId && graph.byId.has(doc.parentId)) doc.parent = graph.byId.get(doc.parentId);
    for (const id of doc.outboundLinks) graph.byId.get(id).backlinks.add(doc.id);
  }
}

export async function createGraph(entries) {
  const documents = [];
  for (const entry of entries) {
    const id = entry.id.replaceAll('\\', '/');
    const raw = readFileSync(path.join(repoRoot, id), 'utf8');
    const parsed = parseSource(id, raw);
    const ast = markdown.parse(parsed.body);
    const h1 = ast.children.find((node) => node.type === 'heading' && node.depth === 1);
    if (!h1) throw new Error(`${id}: a document needs an H1 title`);
    const doc = {
      id, raw, ...parsed, ast, hast: await toHtml.run(ast), title: text(h1),
      kind: kindFor(id), url: routeFor(id, parsed.data), headings: [],
      source: { path: id, commit: release.commit, blobUrl: blobUrl(id), lineRange: [1, raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0)] },
      order: Number(/^docs\/guide\/(\d+)/.exec(id)?.[1] ?? 0),
      parentId: id.startsWith('skills/') && !id.endsWith('/SKILL.md') ? `skills/${id.split('/')[1]}/SKILL.md` : null,
      outboundLinks: new Set(), backlinks: new Set(), supersession: [],
    };
    if (doc.kind === 'Decisions' && id !== 'docs/decisions/index.md') doc.decision = {
      group: id.includes('/historical/') ? 'Historical' : 'Current',
      status: /^Status:\s*(.+)$/im.exec(parsed.body)?.[1] ?? 'See original record',
      date: /\b\d{4}-\d{2}-\d{2}\b/.exec(parsed.body)?.[0] ?? null,
      number: /(?:ADR-)?(\d{3,4})/.exec(doc.title)?.[1] ?? null,
    };
    if (doc.kind === 'Core') doc.lineCounts = { total: doc.source.lineRange[1], body: parsed.body.split('\n').length - (parsed.body.endsWith('\n') ? 1 : 0) };
    if (doc.kind === 'Foundation') {
      doc.articles = ast.children.filter((node) => node.type === 'list').flatMap((list) => list.children.map((item, index) => ({
        number: list.start + index,
        label: text(item.children[0]?.children?.find((node) => node.type === 'strong') ?? item).replace(/\.$/, ''),
        id: `article-${list.start + index}`,
      })));
    }
    if (doc.kind === 'Playbooks') {
      doc.playbook = {
        steps: ast.children.filter((node) => node.type === 'list' && node.ordered).flatMap((list) => list.children.map((item, index) => ({
          number: list.start + index, text: text(item),
          completeWhen: /Complete when:\s*([\s\S]+)/.exec(text(item))?.[1] ?? null,
        }))),
        sourceText: text(ast.children.findLast((node) => node.type === 'paragraph' && text(node).startsWith('Source:')) ?? { value: '' }),
      };
    }
    visit(ast, 'code', (node) => {
      if (!doc.command && /^(?:sh|bash|shell)$/.test(node.lang ?? '')) doc.command = { value: node.value, line: node.position.start.line + parsed.offset };
    });
    validateMetadata(doc);
    prepareHeadings(doc);
    documents.push(doc);
  }
  documents.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const graph = {
    documents, byId: new Map(documents.map((doc) => [doc.id, doc])), byUrl: new Map(),
    specialRoutes: new Map([['/', new Set(['how-it-works', 'reported-defect', 'install-for-your-harness'])], ['/library/', new Set()], ['/evals/', new Set()], ['/search/', new Set()]]),
  };
  for (const doc of documents) {
    if (graph.byUrl.has(doc.url)) throw new Error(`Duplicate canonical route ${doc.url}: ${doc.id}`);
    graph.byUrl.set(doc.url, doc);
  }
  assignDecisionGroups(graph);
  const failures = [];
  for (const doc of documents) {
    try { decorateHtml(doc, graph); }
    catch (error) { failures.push(error.message); }
  }
  if (failures.length) throw new Error(`Invalid content graph:\n${failures.join('\n')}`);
  deriveRelationships(graph);
  graph.index = documents.map(({ id, kind, title, url, headings, source, outboundLinks, backlinks, parentId, order }) => ({ id, kind, title, url, headings, source, outboundLinks: [...outboundLinks], backlinks: [...backlinks], parentId, order }));
  return graph;
}

export const catalogKinds = ['Skills', 'Principles', 'Playbooks', 'Mode', 'Core'];
export const publicRoutes = (graph) => ['/', '/library/', '/evals/', '/search/', ...graph.documents.map((doc) => doc.url)];
