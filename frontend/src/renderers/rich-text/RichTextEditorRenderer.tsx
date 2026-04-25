// frontend/src/renderers/rich-text/RichTextEditorRenderer.tsx
//
// Editor-mode renderer for sectionType='rich-text'.
// Wraps TiptapEditor — no task list.

import type { SectionRendererProps } from '../types';
import TiptapEditor from '../../components/doc-editor/TiptapEditor';

export default function RichTextEditorRenderer({
  section,
  fragment,
  ydoc,
  provider,
  user,
  editable,
  onUpdateCursorInfo,
}: SectionRendererProps) {
  if (!fragment || !ydoc) {
    return (
      <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13, padding: '8px 0' }}>
        No content yet.
      </div>
    );
  }

  return (
    <TiptapEditor
      fragment={fragment}
      ydoc={ydoc}
      provider={provider ?? null}
      user={user ?? { name: 'Anonymous', color: '#6b7280' }}
      editable={editable}
      placeholder={section.placeholder ?? 'Write content...'}
      sectionId={section.id}
      onUpdateCursorInfo={onUpdateCursorInfo}
    />
  );
}
