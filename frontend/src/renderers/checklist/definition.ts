import type { FieldTypeDefinition } from '../registry';

const definition: FieldTypeDefinition = {
  type: 'checklist',
  label: 'Checklist',
  icon: '☑️',
  description: 'Simple yes/no checklist items',
  rendererKeys: {
    editor: ['checklist:editor'],
    ack:    ['checklist:ack'],
    reader: ['checklist:reader'],
  },
  rendererLabels: {
    'checklist:editor': 'Checklist Editor',
    'checklist:ack':    'Checklist Viewer',
    'checklist:reader': 'Checklist Viewer',
  },
};

export default definition;
