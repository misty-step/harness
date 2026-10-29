// System is the default. A saved explicit choice is the only override.
try {
  const theme = localStorage.getItem('mistystack-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch { /* Reading and the system theme still work when storage is disabled. */ }
