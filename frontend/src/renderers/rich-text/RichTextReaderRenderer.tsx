// frontend/src/renderers/rich-text/RichTextReaderRenderer.tsx
//
// Reader-mode renderer for sectionType='rich-text'.
// Shows read-only Tiptap content with a jump-to-editor link.

import type { SectionRendererProps } from '../types';
import TiptapEditor from '../../components/doc-editor/TiptapEditor';

export default function RichTextReaderRenderer({
  section,
  fragment,
  ydoc,
  provider,
  onNavigateToEditor,
}: SectionRendererProps) {
  const hasContent = !!fragment && !!ydoc;

  return (
    <div>
      {hasContent ? (
        <div
          style={{
            border: '1px solid #e0f2fe',
            borderLeft: '3px solid #38bdf8',
            borderRadius: 6,
            padding: '10px 14px',
            background: '#f0f9ff',
            fontSize: 14,
            color: '#1e293b',
            lineHeight: 1.6,
          }}
        >
          <TiptapEditor
            fragment={fragment}
            ydoc={ydoc}
            provider={provider ?? null}
            user={{ name: '', color: '#6b7280' }}
            editable={false}
            sectionId={section.id}
          />
        </div>
      ) : (
        <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>No content.</div>
      )}

      {onNavigateToEditor && (
        <button
          type="button"
          onClick={() => onNavigateToEditor(section.id)}
          style={{
            marginTop: 8,
            background: 'none',
            border: 'none',
            color: '#3b82f6',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          Edit in editor →
        </button>
      )}
    </div>
  );
}
