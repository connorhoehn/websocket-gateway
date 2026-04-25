import type { FieldTypeDefinition } from '../registry';

const definition: FieldTypeDefinition = {
  type: 'rich-text',
  label: 'Rich Text',
  icon: '📝',
  description: 'Formatted content with headings and lists',
  rendererKeys: {
    editor: ['rich-text:editor'],
    ack:    ['rich-text:ack'],
    reader: ['rich-text:reader'],
  },
  rendererLabels: {
    'rich-text:editor': 'Rich Text Editor',
    'rich-text:ack':    'Rich Text Viewer',
    'rich-text:reader': 'Rich Text Viewer',
  },
};

export default definition;
