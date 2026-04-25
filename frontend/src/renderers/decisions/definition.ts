import type { FieldTypeDefinition } from '../registry';

const definition: FieldTypeDefinition = {
  type: 'decisions',
  label: 'Decisions',
  icon: '🎯',
  description: 'Decision log with rationale and context',
  rendererKeys: {
    editor: ['decisions:editor'],
    ack:    ['decisions:ack'],
    reader: ['decisions:reader'],
  },
  rendererLabels: {
    'decisions:editor': 'Decisions Editor',
    'decisions:ack':    'Decisions Viewer',
    'decisions:reader': 'Decisions Viewer',
  },
};

export default definition;
