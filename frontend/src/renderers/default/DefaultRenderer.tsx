// frontend/src/renderers/default/DefaultRenderer.tsx
//
// Fallback renderer — used when no specific renderer is registered.
// Shows rich text (if fragment) + task list (if items exist).

import { useRef } from 'react';
import type { SectionRendererProps } from '../types';
import TiptapEditor from '../../components/doc-editor/TiptapEditor';
import TaskList from '../../components/doc-editor/TaskList';

export default function DefaultRenderer({
  section,
  fragment,
  ydoc,
  provider,
  user,
  editable,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  onUpdateCursorInfo,
}: SectionRendererProps) {
  const focusLastItemRef = useRef(false);

  const handleAddItem = () => {
    onAddItem?.({ text: '', status: 'pending', assignee: '', ackedBy: '', ackedAt: '', priority: 'medium', notes: '' });
    focusLastItemRef.current = true;
  };

  return (
    <div>
      {fragment && ydoc && (
        <TiptapEditor
          fragment={fragment}
          ydoc={ydoc}
          provider={provider ?? null}
          user={user ?? { name: 'Anonymous', color: '#6b7280' }}
          editable={editable}
          placeholder={section.placeholder ?? `Write ${section.type} content...`}
          sectionId={section.id}
          onUpdateCursorInfo={onUpdateCursorInfo}
        />
      )}
      {(section.items.length > 0 || editable) && (
        <TaskList
          items={section.items}
          editable={editable}
          onUpdateItem={(id, patch) => onUpdateItem?.(id, patch)}
          onRemoveItem={(id) => onRemoveItem?.(id)}
          focusLastItem={focusLastItemRef}
        />
      )}
      {editable && (
        <button
          type="button"
          onClick={handleAddItem}
          style={{
            marginTop: 8,
            padding: '6px 14px',
            fontSize: 13,
            border: '1px dashed #cbd5e1',
            borderRadius: 6,
            background: 'transparent',
            color: '#64748b',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          + Add item
        </button>
      )}
    </div>
  );
}
