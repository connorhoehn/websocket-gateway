import type { FieldTypeDefinition } from '../registry';

// Phase 51 / hub#66 — Diagram section type. v1 stub. Renderers fall
// through to DefaultRenderer until a follow-up adds real image/SVG
// upload + display. See hub follow-up task.

const definition: FieldTypeDefinition = {
  type: 'diagram',
  label: 'Diagram',
  icon: '▦',
  description: 'Embedded image or SVG (placeholder until upload pipeline lands)',
  rendererKeys: {
    editor: ['diagram:editor'],
    ack:    ['diagram:ack'],
    reader: ['diagram:reader'],
  },
  rendererLabels: {
    'diagram:editor': 'Diagram Editor',
    'diagram:ack':    'Diagram Viewer',
    'diagram:reader': 'Diagram Viewer',
  },
};

export default definition;
