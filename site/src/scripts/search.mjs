const form = document.querySelector('[data-search-form]');
const query = form.elements.namedItem('q');
const section = form.elements.namedItem('section');
const status = document.querySelector('[data-search-status]');
const results = document.querySelector('[data-search-results]');
const more = document.querySelector('[data-search-more]');
const params = new URLSearchParams(location.search);
query.value = params.get('q') ?? '';
section.value = params.get('section') ?? '';
let pagefind;
let request = 0;
let matches = [];
let shown = 0;

async function appendResults(current) {
  const batch = matches.slice(shown, shown + 20);
  const documents = await Promise.all(batch.map((result) => result.data()));
  if (current !== request) return;
  for (const result of documents) {
    const item = document.createElement('li');
    item.className = 'entry';
    const heading = document.createElement('h2');
    heading.className = 'entry-title';
    const link = document.createElement('a');
    link.href = result.url;
    link.textContent = result.meta.title;
    heading.append(link);
    const excerpt = document.createElement('p');
    excerpt.className = 'entry-body';
    // Pagefind documents its excerpt HTML as escaped text plus safe <mark> tags.
    excerpt.innerHTML = result.excerpt;
    item.append(heading, excerpt);
    const headings = (result.sub_results ?? []).filter((entry) => entry.url.includes('#'));
    if (headings.length) {
      const list = document.createElement('ul');
      for (const entry of headings) {
        const child = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = entry.url;
        anchor.textContent = entry.title;
        child.append(anchor);
        list.append(child);
      }
      item.append(list);
    }
    results.append(item);
  }
  shown += batch.length;
  more.hidden = shown >= matches.length;
}

async function search() {
  const current = ++request;
  const term = query.value.trim();
  const params = new URLSearchParams();
  if (term) params.set('q', term);
  if (section.value) params.set('section', section.value);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  results.replaceChildren();
  more.hidden = true;
  if (!term && !section.value) { status.textContent = 'Enter a term or choose a section.'; return; }
  status.textContent = 'Searching this revision…';
  try {
    pagefind ??= import(/* @vite-ignore */ '/pagefind/pagefind.js');
    const api = await pagefind;
    const found = await api.debouncedSearch(term || null, section.value ? { filters: { section: section.value } } : {});
    if (!found || current !== request) return;
    matches = found.results;
    shown = 0;
    status.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? 'page' : 'pages'} found.` : 'No results. Try another term or browse the library below.';
    await appendResults(current);
  } catch {
    if (current !== request) return;
    results.replaceChildren();
    status.textContent = 'Search is unavailable. Browse the library or guide below; reading does not depend on search.';
  }
}
form.addEventListener('submit', (event) => { event.preventDefault(); search(); });
query.addEventListener('input', search);
section.addEventListener('change', search);
more.addEventListener('click', async () => {
  more.disabled = true;
  try { await appendResults(request); }
  catch { status.textContent = 'More results could not load. Try the search again or browse the library.'; }
  finally { more.disabled = false; }
});
if (query.value || section.value) search();
