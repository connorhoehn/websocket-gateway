// frontend/src/components/doc-editor/TaskItemRow.tsx
//
// A single task item row with checkbox, text input, and metadata badges.

import type { TaskItem } from '../../types/document';

export interface TaskItemRowProps {
  item: TaskItem;
  editable: boolean;
  onUpdate: (patch: Partial<TaskItem>) => void;
  onRemove: () => void;
}

const statusColors: Record<TaskItem['status'], string> = {
  pending: '#94a3b8',
  acked: '#3b82f6',
  done: '#22c55e',
  rejected: '#ef4444',
};

const priorityColors: Record<TaskItem['priority'], string> = {
  low: '#94a3b8',
  medium: '#f97316',
  high: '#ef4444',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderBottom: '1px solid #f1f5f9',
};

const badgeStyle = (bg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 12,
  background: bg,
  color: '#fff',
  textTransform: 'capitalize',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
});

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  fontSize: 14,
  fontFamily: 'inherit',
  background: 'transparent',
  padding: '2px 4px',
};

const deleteBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#ef4444',
  cursor: 'pointer',
  fontSize: 16,
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

export default function TaskItemRow({ item, editable, onUpdate, onRemove }: TaskItemRowProps) {
  const toggleStatus = () => {
    const next = item.status === 'done' ? 'pending' : 'done';
    onUpdate({ status: next });
  };

  return (
    <div style={rowStyle}>
      <input
        type="checkbox"
        checked={item.status === 'done'}
        onChange={toggleStatus}
        disabled={!editable}
        style={{ cursor: editable ? 'pointer' : 'default', width: 16, height: 16 }}
      />

      <input
        type="text"
        value={item.text}
        onChange={(e) => onUpdate({ text: e.target.value })}
        readOnly={!editable}
        style={{
          ...inputStyle,
          textDecoration: item.status === 'done' ? 'line-through' : 'none',
          color: item.status === 'done' ? '#94a3b8' : '#1e293b',
        }}
      />

      <span style={badgeStyle(priorityColors[item.priority])}>
        {item.priority}
      </span>

      <span style={badgeStyle(statusColors[item.status])}>
        {item.status}
      </span>

      {editable && (
        <button type="button" onClick={onRemove} style={deleteBtnStyle} title="Remove task">
          x
        </button>
      )}
    </div>
  );
}
