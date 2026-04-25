// frontend/src/renderers/tasks/TasksEditorRenderer.tsx
//
// Editor-mode renderer for sectionType='tasks'.
// Pure TODO list — no rich-text editor; items are added and edited inline.

import { useRef } from 'react';
import type { SectionRendererProps } from '../types';
import TaskList from '../../components/doc-editor/TaskList';

export default function TasksEditorRenderer({
  section,
  editable,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: SectionRendererProps) {
  const focusLastItemRef = useRef(false);

  const handleAddItem = () => {
    onAddItem?.({
      text: '',
      status: 'pending',
      assignee: '',
      ackedBy: '',
      ackedAt: '',
      priority: 'medium',
      notes: '',
    });
    focusLastItemRef.current = true;
  };

  return (
    <div style={{ padding: '4px 0' }}>
      {section.items.length > 0 || editable ? (
        <TaskList
          items={section.items}
          editable={editable}
          onUpdateItem={(id, patch) => onUpdateItem?.(id, patch)}
          onRemoveItem={(id) => onRemoveItem?.(id)}
          focusLastItem={focusLastItemRef}
        />
      ) : null}

      {section.items.length === 0 && !editable && (
        <p style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic', margin: '8px 0' }}>
          No items yet.
        </p>
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
