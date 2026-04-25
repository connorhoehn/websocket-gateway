import { useRef, useEffect } from 'react';
import type { SectionRendererProps } from '../types';
import type { TaskItem } from '../../types/document';
import TiptapEditor from '../../components/doc-editor/TiptapEditor';

interface RowProps {
  item: TaskItem;
  editable: boolean;
  autoFocus?: boolean;
  onDidAutoFocus?: () => void;
  onUpdate: (patch: Partial<TaskItem>) => void;
  onRemove: () => void;
}

function ChecklistRow({ item, editable, autoFocus, onDidAutoFocus, onUpdate, onRemove }: RowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const done = item.status === 'done';

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      onDidAutoFocus?.();
    }
  }, [autoFocus, onDidAutoFocus]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => onUpdate({ status: done ? 'pending' : 'done' })}
        disabled={!editable}
        style={{ width: 15, height: 15, accentColor: '#10b981', cursor: editable ? 'pointer' : 'default', flexShrink: 0 }}
      />
      <input
        ref={inputRef}
        type="text"
        value={item.text}
        onChange={(e) => onUpdate({ text: e.target.value })}
        readOnly={!editable}
        placeholder="Checklist item..."
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          fontSize: 14,
          fontFamily: 'inherit',
          background: 'transparent',
          color: done ? '#94a3b8' : '#1e293b',
          textDecoration: done ? 'line-through' : 'none',
          padding: '2px 4px',
        }}
      />
      {editable && (
        <button
          type="button"
          onClick={onRemove}
          style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function ChecklistEditorRenderer({
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
  const focusLastRef = useRef(false);

  const handleAdd = () => {
    onAddItem?.({ text: '', status: 'pending', assignee: '', ackedBy: '', ackedAt: '', priority: 'medium', notes: '' });
    focusLastRef.current = true;
  };

  const total = section.items.length;
  const doneCount = section.items.filter(i => i.status === 'done').length;

  return (
    <div>
      {fragment && ydoc && (
        <TiptapEditor
          fragment={fragment}
          ydoc={ydoc}
          provider={provider ?? null}
          user={user ?? { name: 'Anonymous', color: '#6b7280' }}
          editable={editable}
          placeholder={section.placeholder ?? 'Add notes or context...'}
          sectionId={section.id}
          onUpdateCursorInfo={onUpdateCursorInfo}
        />
      )}

      {total > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>
          {doneCount} / {total} done
        </div>
      )}

      <div>
        {section.items.map((item, idx) => {
          const isLast = idx === section.items.length - 1;
          const shouldFocus = focusLastRef.current && isLast;
          return (
            <ChecklistRow
              key={item.id}
              item={item}
              editable={editable}
              autoFocus={shouldFocus}
              onDidAutoFocus={shouldFocus ? () => { focusLastRef.current = false; } : undefined}
              onUpdate={(patch) => onUpdateItem?.(item.id, patch)}
              onRemove={() => onRemoveItem?.(item.id)}
            />
          );
        })}
      </div>

      {editable && (
        <button
          type="button"
          onClick={handleAdd}
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
