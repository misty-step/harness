import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Read canonical files in place. The repository path, not a generated slug,
// remains the identity of each document in the public graph.
const repository = defineCollection({
  loader: glob({
    base: new URL('../../', import.meta.url),
    pattern: [
      'skills/**/*.md',
      'rules/core.md',
      'docs/**/*.md',
      '!docs/decisions/0000-template.md',
      'README.md', 'DOMAIN.md', 'USER_STORIES.md', 'ATTRIBUTION.md',
      'CHANGELOG.md', 'CONTRIBUTING.md', 'FOUNDATIONS.md', 'SPEC.md',
    ],
    generateId: ({ entry }) => entry,
    deferRender: true,
  }),
});

export const collections = { repository };
