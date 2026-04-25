import type { FieldTypeDefinition } from '../registry';

const definition: FieldTypeDefinition = {
  type: 'tasks',
  label: 'Task List',
  icon: '✅',
  description: 'Assignable action items with status tracking',
  rendererKeys: {
    editor: ['tasks:editor'],
    ack:    ['tasks:ack'],
    reader: ['tasks:reader'],
  },
  rendererLabels: {
    'tasks:editor': 'Task Editor',
    'tasks:ack':    'Task Review',
    'tasks:reader': 'Task Reader',
  },
};

export default definition;
