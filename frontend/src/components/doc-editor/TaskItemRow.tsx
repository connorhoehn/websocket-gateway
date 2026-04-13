// frontend/src/components/doc-editor/TaskItemRow.tsx
//
// A single task item row with checkbox, text input, and metadata badges.

import { useState, useRef, useEffect, useCallback } from 'react';
import type { TaskItem } from '../../types/document';
import { DEV_USERS, findUserByName } from '../../data/userDirectory';
import type { DirectoryUser } from '../../data/userDirectory';

export interface TaskItemRowProps {
  item: TaskItem;
  editable: boolean;
  onUpdate: (patch: Partial<TaskItem>) => void;
  onRemove: () => void;
  /** When true, auto-focus the text input on mount. */
  autoFocusText?: boolean;
  /** Called after auto-focus completes so parent can reset the flag. */
  onDidAutoFocus?: () => void;
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
  background: hasAssignee ? '#e0e7ff' : '#fff',
  color: hasAssignee ? '#4338ca' : '#94a3b8',
  cursor: 'pointer',
  border: hasAssignee ? 'none' : '1px dashed #cbd5e1',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
});

const assigneeInputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  outline: 'none',
  height: 28,
  background: '#fff',
  color: '#1e293b',
  boxSizing: 'border-box',
};

const assigneeDropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  minWidth: 180,
  maxHeight: 200,
  overflowY: 'auto',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  zIndex: 1000,
  padding: '4px 0',
};

const assigneeOptionStyle = (highlighted: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
  background: highlighted ? '#f1f5f9' : 'transparent',
  border: 'none',
  width: '100%',
  textAlign: 'left',
  fontFamily: 'inherit',
  color: '#1e293b',
});

const avatarCircleStyle = (color: string, size: number): React.CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
  background: color,
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: size * 0.45,
  fontWeight: 700,
  flexShrink: 0,
  lineHeight: 1,
});

export default function TaskItemRow({ item, editable, onUpdate, onRemove, autoFocusText, onDidAutoFocus }: TaskItemRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const toggleStatus = () => {
    const next = item.status === 'done' ? 'pending' : 'done';
    onUpdate({ status: next });
  };

  const getInitials = (name: string) => {
    return name
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Resolve the current assignee to a directory user (for color)
  const assigneeUser: DirectoryUser | undefined = item.assignee
    ? DEV_USERS.find(u => u.displayName === item.assignee)
    : undefined;

  // Filtered user list based on typed text
  const filteredUsers = filterText.trim()
    ? findUserByName(filterText)
    : DEV_USERS;

  const openPicker = useCallback(() => {
    if (!editable) return;
    setFilterText('');
    setHighlightIdx(0);
    setPickerOpen(true);
  }, [editable]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setFilterText('');
    setHighlightIdx(0);
  }, []);

  const selectUser = useCallback((user: DirectoryUser) => {
    onUpdate({ assignee: user.displayName });
    closePicker();
  }, [onUpdate, closePicker]);

  const clearAssignee = useCallback(() => {
    onUpdate({ assignee: '' });
    closePicker();
  }, [onUpdate, closePicker]);

  // Close on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        closePicker();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen, closePicker]);

  // Focus input when picker opens
  useEffect(() => {
    if (pickerOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [pickerOpen]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [filterText]);

  // Auto-focus the text input when this item is newly added
  useEffect(() => {
    if (autoFocusText && textInputRef.current) {
      textInputRef.current.focus();
      onDidAutoFocus?.();
    }
  }, [autoFocusText, onDidAutoFocus]);

  const handlePickerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closePicker();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filteredUsers.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredUsers[highlightIdx]) {
        selectUser(filteredUsers[highlightIdx]);
      }
    }
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
        style={{ cursor: editable ? 'pointer' : 'default', width: 16, height: 16, accentColor: '#3b82f6', background: '#fff', WebkitAppearance: 'checkbox' as never }}
      />

      <input
        ref={textInputRef}
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

      {/* Assignee picker */}
      <div ref={pickerRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={openPicker}
          style={assigneeBadgeStyle(!!item.assignee)}
          title={item.assignee || 'Unassigned'}
        >
          {item.assignee ? (
            <>
              <span style={avatarCircleStyle(assigneeUser?.color ?? '#94a3b8', 18)}>
                {getInitials(item.assignee)}
              </span>
              <span style={{ marginLeft: 4, fontSize: 11 }}>{item.assignee.split(' ')[0]}</span>
            </>
          ) : (
            '+'
          )}
        </button>

        {pickerOpen && (
          <div style={assigneeDropdownStyle}>
            <div style={{ padding: '4px 8px' }}>
              <input
                ref={inputRef}
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={handlePickerKeyDown}
                placeholder="Search users..."
                style={assigneeInputStyle}
              />
            </div>

            {/* Unassign option */}
            {item.assignee && (
              <button
                type="button"
                onClick={clearAssignee}
                style={assigneeOptionStyle(false)}
              >
                <span style={{ ...avatarCircleStyle('#cbd5e1', 22), color: '#64748b' }}>--</span>
                <span style={{ color: '#64748b', fontStyle: 'italic' }}>Unassigned</span>
              </button>
            )}

            {filteredUsers.map((user, idx) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => selectUser(user)}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={assigneeOptionStyle(idx === highlightIdx)}
              >
                <span style={avatarCircleStyle(user.color, 22)}>
                  {getInitials(user.displayName)}
                </span>
                <span>{user.displayName}</span>
              </button>
            ))}

            {filteredUsers.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: '#94a3b8' }}>
                No users found
              </div>
            )}
          </div>
        )}
      </div>

      <select
        value={item.priority}
        disabled={!editable}
        onChange={(e) => onUpdate({ priority: e.target.value as TaskItem['priority'] })}
        style={{
          ...badgeStyle(priorityColors[item.priority]),
          border: 'none',
          cursor: editable ? 'pointer' : 'default',
          appearance: 'none',
          WebkitAppearance: 'none',
          paddingRight: 16,
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'8\' height=\'5\' viewBox=\'0 0 8 5\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0l4 5 4-5z\' fill=\'%23fff\'/%3E%3C/svg%3E")',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 5px center',
          backgroundSize: '8px 5px',
          outline: 'none',
        }}
        title={`Priority: ${item.priority}`}
      >
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>

      <select
        value={item.status}
        disabled={!editable}
        onChange={(e) => onUpdate({ status: e.target.value as TaskItem['status'] })}
        style={{
          ...badgeStyle(statusColors[item.status]),
          border: 'none',
          cursor: editable ? 'pointer' : 'default',
          appearance: 'none',
          WebkitAppearance: 'none',
          paddingRight: 16,
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'8\' height=\'5\' viewBox=\'0 0 8 5\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0l4 5 4-5z\' fill=\'%23fff\'/%3E%3C/svg%3E")',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 5px center',
          backgroundSize: '8px 5px',
          outline: 'none',
        }}
        title={`Status: ${item.status}`}
      >
        <option value="pending">pending</option>
        <option value="acked">acked</option>
        <option value="done">done</option>
        <option value="rejected">rejected</option>
      </select>

      {editable && (
        <button type="button" onClick={onRemove} style={deleteBtnStyle} title="Remove task">
          x
        </button>
      )}
    </div>
  );
}
