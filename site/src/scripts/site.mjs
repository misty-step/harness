const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
const updateThemeLabels = () => {
  for (const button of themeButtons) {
    button.textContent = `Theme: ${document.documentElement.dataset.theme || 'system'}`;
    button.hidden = false;
  }
};
updateThemeLabels();
for (const themeButton of themeButtons) {
  themeButton.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'system';
    const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'system') localStorage.removeItem('mistystack-theme');
      else localStorage.setItem('mistystack-theme', next);
    } catch { /* The selected theme still applies for this page. */ }
    updateThemeLabels();
  });
}

for (const button of document.querySelectorAll('[data-copy-command]')) {
  if (!navigator.clipboard) continue;
  button.hidden = false;
  button.addEventListener('click', async () => {
    const block = button.closest('.command-block');
    const status = block.querySelector('[data-copy-status]');
    try {
      await navigator.clipboard.writeText(block.querySelector('code').textContent);
      status.textContent = 'Command copied.';
    } catch {
      status.textContent = 'Copy was unavailable. Select and copy the command above.';
    }
  });
}

for (const disclosure of document.querySelectorAll('.mobile-menu, .browse-mobile, .toc-mobile')) {
  disclosure.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a');
    if (!link) return;
    disclosure.open = false;
    const destination = new URL(link.href);
    if (destination.pathname === location.pathname && destination.hash) {
      const target = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }
  });
  disclosure.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !disclosure.open) return;
    disclosure.open = false;
    disclosure.querySelector('summary').focus();
  });
}
