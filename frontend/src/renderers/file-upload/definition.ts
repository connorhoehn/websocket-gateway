import type { FieldTypeDefinition } from '../registry';

// Phase 51 / hub#66 — File Upload section type. v1 stub: the section
// appears in the wizard's section-type picker and is configurable.
// Editor + reader components fall through to DefaultRenderer until a
// follow-up wires real upload + storage. See follow-up hub task.

const definition: FieldTypeDefinition = {
  type: 'file-upload',
  label: 'File Upload',
  icon: '📎',
  description: 'Upload a file at edit time; download link in viewer',
  rendererKeys: {
    editor: ['file-upload:editor'],
    ack:    ['file-upload:ack'],
    reader: ['file-upload:reader'],
  },
  rendererLabels: {
    'file-upload:editor': 'File Upload Editor',
    'file-upload:ack':    'File Upload Viewer',
    'file-upload:reader': 'File Upload Viewer',
  },
};

export default definition;
