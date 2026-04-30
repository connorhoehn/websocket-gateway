import type { FieldTypeDefinition } from '../registry';

// Phase 51 / hub#66 — Link Block section type. v1 stub. A list of
// {label, url} pairs rendered as clickable links. Renderers fall
// through to DefaultRenderer until a follow-up implements the
// editor + reader.

const definition: FieldTypeDefinition = {
  type: 'link-block',
  label: 'Link Block',
  icon: '🔗',
  description: 'List of external links (label + url pairs)',
  rendererKeys: {
    editor: ['link-block:editor'],
    ack:    ['link-block:ack'],
    reader: ['link-block:reader'],
  },
  rendererLabels: {
    'link-block:editor': 'Link Block Editor',
    'link-block:ack':    'Link Block Viewer',
    'link-block:reader': 'Link Block Viewer',
  },
};

export default definition;
