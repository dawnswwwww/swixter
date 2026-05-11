import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { embedRawSource } from './src/plugins/embed-raw-source.mjs';

const COPY_BUTTON_SCRIPT = `
function initCopyButton() {
  var src = document.querySelector('.raw-markdown-source');
  if (!src || !src.dataset.encoded) return;
  var md = atob(src.dataset.encoded);

  var label = 'Copy this page';
  var btn = document.createElement('button');
  btn.className = 'copy-md-btn';
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
  btn.onclick = function() {
    navigator.clipboard.writeText(md).then(function() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() { btn.textContent = label; btn.classList.remove('copied'); }, 2000);
    }).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = md; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      btn.textContent = 'Copied!'; btn.classList.add('copied');
      setTimeout(function() { btn.textContent = label; btn.classList.remove('copied'); }, 2000);
    });
  };

  // Place button next to the page title h1
  var h1 = document.querySelector('.sl-markdown-content h1');
  if (h1) {
    h1.style.display = 'flex';
    h1.style.alignItems = 'center';
    h1.style.justifyContent = 'space-between';
    h1.style.gap = '1rem';
    var wrap = h1.parentNode;
    btn.style.marginLeft = 'auto';
    h1.appendChild(btn);
  }
}
document.addEventListener('DOMContentLoaded', initCopyButton);
initCopyButton();
`;

export default defineConfig({
  site: 'https://docs.swixter.cc',
  markdown: {
    remarkPlugins: [embedRawSource],
  },
  integrations: [
    starlight({
      title: 'Swixter Docs',
      description: 'Documentation for Swixter — the AI coding assistant configuration manager.',
      customCss: ['./src/styles/theme.css'],
      head: [
        { tag: 'script', content: COPY_BUTTON_SCRIPT },
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
            {
              label: 'Coder Commands',
              items: [
                { slug: 'commands/claude' },
                { slug: 'commands/codex' },
              ],
            },
            { slug: 'commands/providers' },
            { slug: 'commands/groups' },
            { slug: 'commands/proxy' },
            { slug: 'commands/ui' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { slug: 'advanced/cloud-sync' },
            { slug: 'advanced/windows' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/changelog' },
          ],
        },
      ],
    }),
  ],
});
