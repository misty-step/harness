const form = document.querySelector('[data-catalog-controls]');
const items = [...document.querySelectorAll('[data-catalog-item]')];
const query = form.elements.namedItem('q');
const section = form.elements.namedItem('section');
const initial = new URLSearchParams(location.search);
query.value = initial.get('q') ?? '';
section.value = initial.get('section') ?? '';
form.hidden = false;
function filter(updateUrl = true) {
  let count = 0;
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const item of items) {
    item.hidden = Boolean(section.value && item.dataset.section !== section.value) || !terms.every((term) => item.dataset.search.includes(term));
    if (!item.hidden) count++;
  }
  document.querySelector('[data-catalog-status]').textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
  document.querySelector('[data-catalog-empty]').hidden = count > 0;
  if (updateUrl) {
    const params = new URLSearchParams();
    if (query.value.trim()) params.set('q', query.value.trim());
    if (section.value) params.set('section', section.value);
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
}
form.addEventListener('submit', (event) => { event.preventDefault(); filter(); });
query.addEventListener('input', () => filter());
section.addEventListener('change', () => filter());
filter(false);
