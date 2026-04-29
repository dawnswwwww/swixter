import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.swixter.cc',
  integrations: [
    starlight({
      title: 'Swixter Docs',
      description: 'Documentation for Swixter — the AI coding assistant configuration manager.',
      customCss: ['./src/styles/theme.css'],
      head: [
        {
          tag: 'script',
          content: 'document.documentElement.dataset.theme = "dark";',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { slug: 'getting-started/installation' },
            { slug: 'getting-started/quick-start' },
            { slug: 'getting-started/configuration' },
          ],
        },
        {
          label: 'Commands',
          items: [
            { slug: 'commands/claude' },
            { slug: 'commands/codex' },
            { slug: 'commands/qwen' },
            { slug: 'commands/providers' },
            { slug: 'commands/groups' },
            { slug: 'commands/proxy' },
            { slug: 'commands/sync' },
            { slug: 'commands/ui' },
          ],
        },
        {
          label: 'Providers',
          items: [
            { slug: 'providers/anthropic' },
            { slug: 'providers/ollama' },
            { slug: 'providers/openai' },
            { slug: 'providers/custom' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { slug: 'advanced/windows' },
            { slug: 'advanced/cloud-sync' },
            { slug: 'advanced/proxy' },
          ],
        },
      ],
    }),
  ],
});
