// frontend/src/components/doc-editor/TaskItemRow.tsx
//
// A single task item row with checkbox, text input, and metadata badges.

import { useState } from 'react';
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

const categoryColors: Record<string, string> = {
  start: '#22c55e',
  stop: '#ef4444',
  continue: '#3b82f6',
};

/** Format an ISO date string as a short label like "Apr 15". */
function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Return true if the ISO date is in the past (ignoring time). */
function isOverdue(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

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

const assigneeBadgeStyle = (hasAssignee: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: hasAssignee ? 'auto' : 24,
  height: 24,
  padding: hasAssignee ? '2px 8px' : 0,
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 12,
  background: hasAssignee ? '#e0e7ff' : '#f1f5f9',
  color: hasAssignee ? '#4338ca' : '#94a3b8',
  cursor: 'pointer',
  border: 'none',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
});

const assigneeInputStyle: React.CSSProperties = {
  width: 100,
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '2px 8px',
  borderRadius: 12,
  border: '1px solid #c7d2fe',
  outline: 'none',
  height: 24,
};

export default function TaskItemRow({ item, editable, onUpdate, onRemove }: TaskItemRowProps) {
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState(item.assignee || '');

  const toggleStatus = () => {
    const next = item.status === 'done' ? 'pending' : 'done';
    onUpdate({ status: next });
  };

  const commitAssignee = () => {
    const trimmed = assigneeDraft.trim();
    onUpdate({ assignee: trimmed });
    setEditingAssignee(false);
  };

  const handleAssigneeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitAssignee();
    } else if (e.key === 'Escape') {
      setAssigneeDraft(item.assignee || '');
      setEditingAssignee(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const overdue = item.dueDate && item.status !== 'done' ? isOverdue(item.dueDate) : false;

  return (
    <div style={rowStyle}>
      {/* Priority dot indicator */}
      <span
        title={`Priority: ${item.priority}`}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: priorityColors[item.priority],
          flexShrink: 0,
        }}
      />

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

      {/* Due date badge */}
      {item.dueDate && (
        <span
          title={item.dueDate}
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 12,
            background: overdue ? '#fef2f2' : '#f0f9ff',
            color: overdue ? '#dc2626' : '#64748b',
            border: overdue ? '1px solid #fecaca' : '1px solid #e0f2fe',
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
          }}
        >
          {overdue ? '\u26A0 ' : ''}Due: {formatDueDate(item.dueDate)}
        </span>
      )}

      {/* Category badge (retro: start/stop/continue, etc.) */}
      {item.category && (
        <span
          style={badgeStyle(categoryColors[item.category.toLowerCase()] ?? '#6b7280')}
        >
          {item.category}
        </span>
      )}

      {/* Assignee badge / editor */}
      {editingAssignee ? (
        <input
          type="text"
          value={assigneeDraft}
          onChange={(e) => setAssigneeDraft(e.target.value)}
          onBlur={commitAssignee}
          onKeyDown={handleAssigneeKeyDown}
          autoFocus
          placeholder="Name..."
          style={assigneeInputStyle}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (editable) {
              setAssigneeDraft(item.assignee || '');
              setEditingAssignee(true);
            }
          }}
          style={assigneeBadgeStyle(!!item.assignee)}
          title={item.assignee || 'Unassigned'}
        >
          {item.assignee ? getInitials(item.assignee) : '+'}
        </button>
      )}

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
