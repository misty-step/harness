// Runs before first paint. The brand stylesheet reads data-theme (light or
// dark): a saved explicit choice wins, otherwise the system setting applies.
// The brand runtime owns data-reduced-motion and data-paused. data-js lets
// the stylesheet show controls that need this site's script.
(() => {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem('mistystack-theme'); } catch { /* Storage may be disabled; the system theme still applies. */ }
  root.dataset.theme = saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.js = '';
})();
