import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Check the artifact, not Astro's source graph: a valid source link can still be
// broken by rendering, heading generation, routing, or the search post-build.
const site = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(site, '..');
const dist = path.join(site, 'dist');
const origin = 'https://stack.mistystep.io';
const errors = [];
const files = new Map();
const pages = new Map();
const redirects = new Map();
const fail = (message) => errors.push(message);
const expect = (condition, message) => { if (!condition) fail(message); };
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name) => {
  if (name[0] === '#') {
    const number = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '\ufffd';
  }
  return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[name.toLowerCase()] ?? entity;
});

async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), `${relative}/`);
    else if (entry.isFile()) files.set(relative, await readFile(path.join(directory, entry.name)));
    else fail(`${relative}: artifact must contain regular files, not symlinks or special files`);
  }
}

function required(file) {
  const bytes = files.get(file);
  expect(bytes?.length > 0, `${file}: missing or empty artifact`);
  return bytes;
}

function json(file) {
  const bytes = required(file);
  if (!bytes) return null;
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (error) { fail(`${file}: invalid JSON: ${error.message}`); return null; }
}

function route(file) {
  if (file === 'index.html') return '/';
  return `/${file.replace(/\/index\.html$/, '/')}`;
}

// A quoted-attribute-aware tokenizer for generated HTML/SVG. Script/style and
// comments are opaque: strings such as '<a href=...>' in code are not links.
function parseHTML(file, text) {
  const result = { ids: new Set(), links: [], tags: [], headings: new Map() };
  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gi;
  let raw = null;
  for (const match of text.matchAll(token)) {
    const closing = /^<\//.test(match[0]);
    const name = /^<\/?([\w:-]+)/.exec(match[0])?.[1].toLowerCase();
    if (!name) continue;
    if (raw) { if (closing && name === raw) raw = null; continue; }
    if (closing) continue;
    const attributes = new Map();
    const body = match[0].replace(/^<\/?[\w:-]+/, '').replace(/\/?>$/, '');
    for (const attribute of body.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = attribute[1].toLowerCase();
      if (!attributes.has(key)) attributes.set(key, decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''));
    }
    const line = text.slice(0, match.index).split('\n').length;
    const label = `${file}:${line} <${name}>`;
    const id = attributes.get('id');
    if (id !== undefined) {
      expect(id.length > 0 && !result.ids.has(id), `${label}: empty or duplicate id ${JSON.stringify(id)}`);
      result.ids.add(id);
      if (/^h[1-6]$/.test(name)) result.headings.set(id, Number(name[1]));
    }
    if (name === 'a' && attributes.has('name')) result.ids.add(attributes.get('name'));
    for (const key of ['href', 'xlink:href', 'src', 'poster', 'action', 'data']) {
      if (attributes.has(key) && (key !== 'data' || name === 'object')) {
        result.links.push({ value: attributes.get(key), label: `${label} ${key}` });
      }
    }
    if (attributes.has('srcset')) {
      // The URL token ends at whitespace, not at commas within a data URI.
      const candidates = attributes.get('srcset');
      let cursor = 0;
      while (cursor < candidates.length) {
        while (/[\s,]/.test(candidates[cursor] ?? '') && cursor < candidates.length) cursor++;
        const start = cursor;
        while (cursor < candidates.length && !/\s/.test(candidates[cursor])) cursor++;
        let value = candidates.slice(start, cursor);
        if (!value) break;
        if (value.endsWith(',')) value = value.replace(/,+$/, '');
        else while (cursor < candidates.length && candidates[cursor] !== ',') cursor++;
        result.links.push({ value, label: `${label} srcset` });
      }
    }
    if (attributes.has('style')) cssLinks(attributes.get('style'), `${label} style`, result.links);
    result.tags.push({ name, attributes });
    if (name === 'script' || name === 'style' || name === 'textarea' || name === 'title') {
      if (name === 'style') {
        const end = text.toLowerCase().indexOf('</style', match.index + match[0].length);
        cssLinks(text.slice(match.index + match[0].length, end < 0 ? undefined : end), label, result.links);
      }
      raw = name;
    }
  }
  return result;
}

function cssLinks(text, label, output) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|@import\s+(?:"([^"]+)"|'([^']+)')/gi)) {
    output.push({ value: match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5], label: `${label} CSS url` });
  }
}

function localURL(value, base, label) {
  try {
    const url = new URL(value, new URL(base, origin));
    if (url.origin !== origin) return null;
    return url;
  } catch { fail(`${label}: malformed URL ${JSON.stringify(value)}`); return null; }
}

function target(url, label) {
  let current = new URL(url);
  const visited = new Set();
  while (redirects.has(current.pathname)) {
    if (visited.has(current.pathname)) { fail(`${label}: redirect cycle at ${current.pathname}`); return null; }
    visited.add(current.pathname);
    const next = new URL(redirects.get(current.pathname), current);
    if (!next.hash) next.hash = current.hash;
    current = next;
    if (current.origin !== origin) return null;
  }
  let pathname;
  try { pathname = decodeURIComponent(current.pathname); }
  catch { fail(`${label}: malformed escaped pathname ${current.pathname}`); return null; }
  const relative = pathname.replace(/^\/+/, '');
  const candidates = pathname.endsWith('/') ? [`${relative}index.html`] : [relative, `${relative}/index.html`, `${relative}.html`];
  const file = candidates.find((candidate) => files.has(candidate));
  if (!file) { fail(`${label}: missing local target ${current.pathname}`); return null; }
  return { file, url: current };
}

function checkLink(value, base, label) {
  const url = localURL(value, base, label);
  if (!url) return null;
  const resolved = target(url, label);
  if (!resolved) return null;
  let fragment;
  try { fragment = decodeURIComponent(resolved.url.hash.slice(1)).split(':~:text=')[0]; }
  catch { fail(`${label}: malformed escaped fragment ${resolved.url.hash}`); return resolved; }
  if (fragment && /\.(html|svg)$/.test(resolved.file)) {
    const page = pages.get(resolved.file);
    expect(page?.ids.has(fragment), `${label}: missing fragment #${fragment} in ${resolved.file}`);
  }
  return resolved;
}

function publicSource(source) {
  if (!nonempty(source) || source.includes('\\') || source.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (!/\.(md|json)$/.test(source)) return false;
  return /^(docs|skills)\//.test(source) || source === 'rules/core.md' || /^(README|DOMAIN|USER_STORIES|ATTRIBUTION|CHANGELOG|CONTRIBUTING|FOUNDATIONS|SPEC)\.md$/.test(source);
}

// Pagefind's pinned bundle uses gzip + a pagefind_dcd marker. Decode its small
// array-based CBOR metadata/filter format so missing filters or stale indexes
// fail here instead of merely checking whether a search directory exists.
function unpack(file) {
  const bytes = required(file);
  if (!bytes) throw new Error(`missing ${file}`);
  const content = gunzipSync(bytes);
  if (content.subarray(0, 12).toString() !== 'pagefind_dcd') throw new Error(`${file}: invalid Pagefind marker`);
  return content.subarray(12);
}

function cbor(bytes) {
  let offset = 0;
  function take(size) {
    if (offset + size > bytes.length) throw new Error('truncated CBOR');
    const slice = bytes.subarray(offset, offset + size);
    offset += size;
    return slice;
  }
  function value() {
    const initial = take(1)[0];
    const major = initial >> 5;
    const extra = initial & 31;
    let size = extra;
    if (extra >= 24 && extra <= 27) {
      const encoded = take(2 ** (extra - 24));
      size = encoded.length === 8 ? Number(encoded.readBigUInt64BE()) : encoded.readUIntBE(0, encoded.length);
      if (!Number.isSafeInteger(size)) throw new Error('unsafe CBOR integer');
    } else if (extra >= 28) throw new Error('unsupported indefinite CBOR value');
    if (major === 0) return size;
    if (major === 1) return -1 - size;
    if (major === 2) return take(size);
    if (major === 3) return take(size).toString('utf8');
    if (major === 4) return Array.from({ length: size }, value);
    if (major === 5) return Object.fromEntries(Array.from({ length: size }, () => [value(), value()]));
    if (major === 7 && extra === 22) return null;
    throw new Error(`unsupported CBOR type ${major}/${extra}`);
  }
  const result = value();
  if (offset !== bytes.length) throw new Error('trailing CBOR bytes');
  return result;
}

async function main() {
  await collect(dist);
  const expectedCommit = process.env.SITE_COMMIT || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const release = json('release.json');
  expect(/^[a-f\d]{40}$/i.test(expectedCommit), 'release.json: expected a full checked-out Git commit');
  if (release) {
    expect(release.commit === expectedCommit, `release.json: commit must equal ${expectedCommit}`);
    expect(release.version === pkg.version, 'release.json: version must equal the root native package version');
    expect(nonempty(release.builtAt) && Number.isFinite(Date.parse(release.builtAt)), 'release.json: builtAt must be an ISO timestamp');
    expect(release.canonical === origin || release.canonical === `${origin}/`, `release.json: canonical must be ${origin}`);
  }

  for (const [file, bytes] of files) {
    if (/\.(html|svg)$/.test(file)) pages.set(file, parseHTML(file, bytes.toString('utf8')));
  }
  for (const line of (files.get('_redirects')?.toString('utf8') ?? '').split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const [from, to, status] = clean.split(/\s+/);
    expect(from?.startsWith('/') && nonempty(to) && /^(301|302|303|307|308)$/.test(status), `_redirects: invalid redirect ${clean}`);
    expect(!from?.includes('*') && !from?.includes(':'), `_redirects: checker requires explicit source paths: ${clean}`);
    if (from && to) {
      expect(!redirects.has(from), `_redirects: duplicate redirect ${from}`);
      redirects.set(from, to);
    }
  }
  for (const [from] of redirects) checkLink(from, '/', `_redirects ${from}`);
  for (const [file, page] of pages) {
    const base = route(file);
    for (const link of page.links) checkLink(link.value, base, link.label);
  }
  for (const [file, bytes] of files) {
    if (!file.endsWith('.css')) continue;
    const links = [];
    cssLinks(bytes.toString('utf8'), file, links);
    for (const link of links) checkLink(link.value, `/${file}`, link.label);
  }
  required('index.html');
  const notFound = required('404.html')?.toString('utf8');
  if (notFound) {
    expect(/404|not found/i.test(notFound), '404.html: must explain the missing page');
    const recovery = pages.get('404.html')?.links.some(({ value }) => /^\/(search|library)\/(?:[?#]|$)/.test(value));
    expect(recovery, '404.html: must link to search or library recovery');
  }

  const index = json('content-index.json');
  expect(Array.isArray(index) && index.length > 0, 'content-index.json: expected a nonempty document array');
  const documents = Array.isArray(index) ? index : [];
  const byId = new Map();
  const byURL = new Map();
  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') { fail('content-index.json: document must be an object'); continue; }
    const label = `content-index.json ${doc.id ?? '(missing id)'}`;
    for (const key of ['id', 'kind', 'title', 'url']) expect(nonempty(doc[key]), `${label}: missing ${key}`);
    expect(!byId.has(doc.id), `${label}: duplicate document id`);
    expect(!byURL.has(doc.url), `${label}: duplicate canonical route ${doc.url}`);
    byId.set(doc.id, doc);
    byURL.set(doc.url, doc);
    expect(typeof doc.url === 'string' && /^\/(?:[^?#]*\/)?$/.test(doc.url), `${label}: URL must be a root-relative trailing-slash route`);
    const rendered = typeof doc.url === 'string' ? checkLink(doc.url, '/', label) : null;
    const page = rendered && pages.get(rendered.file);
    expect(page, `${label}: canonical route must render HTML`);
    if (page) {
      expect(page.tags.some(({ attributes }) => attributes.has('data-pagefind-body')), `${label}: missing data-pagefind-body`);
      expect(page.tags.some(({ name, attributes }) => name === 'meta' && attributes.get('data-pagefind-filter') === 'section[content]' && attributes.get('content') === doc.kind), `${label}: missing Pagefind section filter ${doc.kind}`);
      const canonicals = page.tags.filter(({ name, attributes }) => name === 'link' && attributes.get('rel')?.split(/\s+/).includes('canonical'));
      expect(canonicals.length === 1 && canonicals[0].attributes.get('href') === `${origin}${doc.url}`, `${label}: canonical link must identify its route`);
    }
    expect(Array.isArray(doc.headings), `${label}: headings must be an array`);
    const headingIds = new Set();
    for (const heading of Array.isArray(doc.headings) ? doc.headings : []) {
      expect(heading && nonempty(heading.id) && nonempty(heading.label) && Number.isInteger(heading.depth) && heading.depth >= 1 && heading.depth <= 6, `${label}: invalid heading ${JSON.stringify(heading)}`);
      if (!heading) continue;
      expect(!headingIds.has(heading.id), `${label}: duplicate heading ${heading.id}`);
      headingIds.add(heading.id);
      expect(page?.ids.has(heading.id), `${label}: rendered heading target #${heading.id} is missing`);
      expect(page?.headings.get(heading.id) === heading.depth, `${label}: heading #${heading.id} has the wrong rendered depth`);
    }
    expect(doc.parentId === null || typeof doc.parentId === 'string', `${label}: parentId must be a document id or null`);
    expect(Number.isFinite(doc.order), `${label}: order must be a finite number`);
    for (const key of ['outboundLinks', 'backlinks']) expect(Array.isArray(doc[key]) && doc[key].every(nonempty), `${label}: ${key} must be document id strings`);
    const source = doc.source;
    expect(source && publicSource(source.path), `${label}: source.path must identify allowlisted public content`);
    if (source && publicSource(source.path)) {
      expect(doc.id === source.path, `${label}: id must equal the stable repository path`);
      expect(source.commit === expectedCommit, `${label}: source.commit differs from release identity`);
      const encoded = source.path.split('/').map(encodeURIComponent).join('/');
      expect(source.blobUrl === `https://github.com/misty-step/mistystack/blob/${expectedCommit}/${encoded}`, `${label}: blobUrl must point to the exact source revision`);
      const raw = required(`source/${source.path}`);
      try {
        const original = await readFile(path.join(root, source.path));
        expect(raw?.equals(original), `${label}: raw projection differs from canonical repository bytes`);
      } catch (error) { fail(`${label}: cannot read canonical source: ${error.message}`); }
    }
  }
  for (const doc of documents.filter((value) => value && typeof value === 'object')) {
    if (doc.parentId !== null) expect(byId.has(doc.parentId), `${doc.id}: unknown parentId ${doc.parentId}`);
    for (const id of Array.isArray(doc.outboundLinks) ? doc.outboundLinks : []) {
      const other = byId.get(id);
      expect(other, `${doc.id}: unknown outbound document ${id}`);
      expect(other?.backlinks?.includes(doc.id), `${doc.id}: ${id} lacks the reciprocal backlink`);
    }
    for (const id of Array.isArray(doc.backlinks) ? doc.backlinks : []) {
      const other = byId.get(id);
      expect(other, `${doc.id}: unknown backlink document ${id}`);
      expect(other?.outboundLinks?.includes(doc.id), `${doc.id}: ${id} lacks the reciprocal outbound link`);
    }
  }
  for (const [file, bytes] of files) {
    if (!file.startsWith('source/')) continue;
    const source = file.slice(7);
    if (!publicSource(source)) { fail(`${file}: unexpected non-public raw projection`); continue; }
    try { expect(bytes.equals(await readFile(path.join(root, source))), `${file}: raw projection differs from canonical repository bytes`); }
    catch (error) { fail(`${file}: cannot read canonical source: ${error.message}`); }
  }

  const sitemapURLs = new Set();
  const sitemapFiles = new Set();
  function sitemap(file) {
    if (sitemapFiles.has(file)) { fail(`${file}: repeated/cyclic sitemap`); return; }
    sitemapFiles.add(file);
    const text = required(file)?.toString('utf8') ?? '';
    const nested = /<sitemapindex\b/.test(text);
    expect(nested || /<urlset\b/.test(text), `${file}: must contain a sitemap urlset or index`);
    const locations = [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => decode(match[1]));
    expect(locations.length > 0, `${file}: sitemap must not be empty`);
    for (const location of locations) {
      expect(location.startsWith(`${origin}/`), `${file}: noncanonical sitemap URL ${location}`);
      const resolved = checkLink(location, '/', `${file} <loc>`);
      if (nested && resolved) sitemap(resolved.file);
      else {
        expect(!sitemapURLs.has(location), `${file}: duplicate sitemap URL ${location}`);
        expect(!/[?#]/.test(location) && location.endsWith('/') && !location.includes('/404'), `${file}: invalid page URL ${location}`);
        sitemapURLs.add(location);
      }
    }
  }
  sitemap('sitemap.xml');
  for (const url of ['/', ...byURL.keys()]) expect(sitemapURLs.has(`${origin}${url}`), `sitemap.xml: missing canonical route ${url}`);
  const robots = required('robots.txt')?.toString('utf8') ?? '';
  expect(/^User-agent:\s*\*\s*$/im.test(robots), 'robots.txt: missing public crawler policy');
  expect(!/^Disallow:\s*\/\s*$/im.test(robots), 'robots.txt: public artifact must not disallow the entire site');
  expect(new RegExp(`^Sitemap:\\s*${origin.replaceAll('.', '\\.')}\/sitemap\\.xml\\s*$`, 'im').test(robots), 'robots.txt: missing canonical sitemap URL');

  checkPagefind(byURL);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    console.error(`Site artifact failed ${errors.length} check(s).`);
    process.exitCode = 1;
  } else console.log(`Checked ${pages.size} HTML/SVG files, ${documents.length} documents, local links/fragments, raw sources, release, sitemap, and Pagefind filters.`);
}

function checkPagefind(documents) {
  for (const file of ['pagefind/pagefind.js', 'pagefind/pagefind-ui.js', 'pagefind/pagefind-ui.css']) required(file);
  const entry = json('pagefind/pagefind-entry.json');
  if (!entry) return;
  expect(nonempty(entry.version) && entry.languages && Object.keys(entry.languages).length > 0, 'Pagefind: missing bundle version/languages');
  const found = new Map();
  for (const [language, info] of Object.entries(entry.languages ?? {})) {
    try {
      const metaFile = `pagefind/pagefind.${info.hash}.pf_meta`;
      const meta = cbor(unpack(metaFile));
      expect(meta[0] === entry.version, `${metaFile}: bundle version mismatch`);
      const [version, indexedPages, chunks, filterRefs] = meta;
      if (!version || !Array.isArray(indexedPages) || !Array.isArray(chunks) || !Array.isArray(filterRefs)) throw new Error(`${metaFile}: invalid metadata structure`);
      expect(info.page_count === indexedPages.length && indexedPages.length > 0, `${metaFile}: page count mismatch or empty index`);
      required(`pagefind/wasm.${info.wasm || 'unknown'}.pagefind`);
      expect(chunks.length > 0, `${metaFile}: missing word index`);
      for (const chunk of chunks) unpack(`pagefind/index/${chunk[2]}.pf_index`);
      const fragments = indexedPages.map(([hash]) => {
        const file = `pagefind/fragment/${hash}.pf_fragment`;
        const fragment = JSON.parse(unpack(file).toString('utf8'));
        expect(nonempty(fragment.content), `${file}: empty indexed content`);
        const resolved = checkLink(fragment.url, '/', file);
        const url = resolved ? route(resolved.file) : fragment.url;
        for (const anchor of fragment.anchors ?? []) checkLink(`${fragment.url}#${encodeURIComponent(anchor.id)}`, '/', `${file} anchor`);
        if (documents.has(url)) {
          expect(!found.has(url), `${file}: duplicate indexed document ${url}`);
          found.set(url, fragment);
          expect(fragment.filters?.section?.includes(documents.get(url).kind), `${file}: missing section filter ${documents.get(url).kind}`);
        }
        return fragment;
      });
      let hasSection = false;
      for (const [name, hash] of filterRefs) {
        const file = `pagefind/filter/${hash}.pf_filter`;
        const filter = cbor(unpack(file));
        expect(filter[0] === name && Array.isArray(filter[1]), `${file}: invalid filter index`);
        if (name !== 'section') continue;
        hasSection = true;
        const covered = new Set();
        for (const [kind, numbers] of filter[1]) {
          expect(nonempty(kind) && Array.isArray(numbers) && numbers.length > 0, `${file}: empty section value`);
          for (const number of numbers) {
            expect(Number.isInteger(number) && number >= 0 && number < fragments.length, `${file}: invalid page reference ${number}`);
            expect(fragments[number]?.filters?.section?.includes(kind), `${file}: section ${kind} disagrees with fragment ${number}`);
            covered.add(number);
          }
        }
        fragments.forEach((fragment, number) => {
          if (fragment.filters?.section?.length) expect(covered.has(number), `${file}: missing filtered page ${number}`);
        });
      }
      expect(hasSection, `Pagefind ${language}: section filter index is missing`);
    } catch (error) { fail(`Pagefind ${language}: ${error.message}`); }
  }
  for (const url of documents.keys()) expect(found.has(url), `Pagefind: canonical document ${url} is absent from the built index`);
}

main().catch((error) => {
  console.error(`Site artifact check failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
