/**
 * Remark plugin that embeds the raw markdown source as a base64-encoded
 * <script> tag so client-side JS can offer a "Copy Markdown" button.
 */
export function embedRawSource() {
  return (_tree, file) => {
    const raw = String(file.value ?? '');
    if (!raw.trim()) return;

    const encoded = Buffer.from(raw).toString('base64');

    // Append a script node at end of document that stores the raw source
    _tree.children.push({
      type: 'html',
      value: `<script type="text/plain" class="raw-markdown-source" data-encoded="${encoded}"></script>`,
    });
  };
}
