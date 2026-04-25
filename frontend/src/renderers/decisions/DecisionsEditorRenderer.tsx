import { useRef, useEffect } from 'react';
import type { SectionRendererProps } from '../types';
import type { TaskItem } from '../../types/document';
import TiptapEditor from '../../components/doc-editor/TiptapEditor';

const DECISION_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  pending:  { label: 'Open',    icon: '○', color: '#92400e', bg: '#fef3c7' },
  acked:    { label: 'Decided', icon: '✓', color: '#065f46', bg: '#d1fae5' },
  done:     { label: 'Decided', icon: '✓', color: '#065f46', bg: '#d1fae5' },
  rejected: { label: 'Vetoed',  icon: '✕', color: '#991b1b', bg: '#fee2e2' },
};

interface RowProps {
  item: TaskItem;
  editable: boolean;
  autoFocus?: boolean;
  onDidAutoFocus?: () => void;
  onUpdate: (patch: Partial<TaskItem>) => void;
  onRemove: () => void;
}

function DecisionRow({ item, editable, autoFocus, onDidAutoFocus, onUpdate, onRemove }: RowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = DECISION_META[item.status] ?? DECISION_META.pending;

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      onDidAutoFocus?.();
    }
  }, [autoFocus, onDidAutoFocus]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: meta.bg,
        color: meta.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
        userSelect: 'none',
      }}>
        {meta.icon}
      </span>

      <input
        ref={inputRef}
        type="text"
        value={item.text}
        onChange={(e) => onUpdate({ text: e.target.value })}
        readOnly={!editable}
        placeholder="Describe the decision..."
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          fontSize: 14,
          fontFamily: 'inherit',
          background: 'transparent',
          color: item.status === 'rejected' ? '#94a3b8' : '#1e293b',
          textDecoration: item.status === 'rejected' ? 'line-through' : 'none',
          padding: '2px 4px',
        }}
      />

      {editable && (
        <select
          value={item.status === 'done' ? 'acked' : item.status}
          onChange={(e) => onUpdate({ status: e.target.value as TaskItem['status'] })}
          style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 10,
            border: `1px solid ${meta.color}`,
            background: meta.bg,
            color: meta.color,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none',
            fontFamily: 'inherit',
            flexShrink: 0,
            appearance: 'none',
            WebkitAppearance: 'none',
          }}
        >
          <option value="pending">Open</option>
          <option value="acked">Decided</option>
          <option value="rejected">Vetoed</option>
        </select>
      )}

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

export default function DecisionsEditorRenderer({
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

  return (
    <div>
      {fragment && ydoc && (
        <TiptapEditor
          fragment={fragment}
          ydoc={ydoc}
          provider={provider ?? null}
          user={user ?? { name: 'Anonymous', color: '#6b7280' }}
          editable={editable}
          placeholder={section.placeholder ?? 'Add context or background...'}
          sectionId={section.id}
          onUpdateCursorInfo={onUpdateCursorInfo}
        />
      )}

      {section.items.length === 0 && !editable && (
        <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13, padding: '4px 0' }}>No decisions yet.</div>
      )}

      <div>
        {section.items.map((item, idx) => {
          const isLast = idx === section.items.length - 1;
          const shouldFocus = focusLastRef.current && isLast;
          return (
            <DecisionRow
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
          + Add decision
        </button>
      )}
    </div>
  );
}
