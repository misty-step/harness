import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://stack.mistystep.io',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  vite: {
    // import.meta.url changes when build-time modules become prerender chunks.
    define: { 'process.env.STACK_REPO_ROOT': JSON.stringify(fileURLToPath(new URL('../', import.meta.url))) },
    // Keep even small processed scripts external under script-src 'self'.
    build: { assetsInlineLimit: 0 },
  },
  redirects: {
    '/guide/install-and-setup/': '/install/',
    '/install/hermes/': '/install/#hermes',
  },
});
