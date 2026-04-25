// frontend/src/renderers/tasks/TasksReaderRenderer.tsx
//
// Reader-mode renderer for sectionType='tasks'.
// Compact status-grouped list for individual section cards.
// Supports inline status updates when onUpdateItem is provided.

import { useState } from 'react';
import type { TaskItem } from '../../types/document';
import type { SectionRendererProps } from '../types';

const STATUS_META: Record<TaskItem['status'], { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#92400e', bg: '#fef3c7' },
  acked:   { label: 'Acked',   color: '#1e40af', bg: '#dbeafe' },
  done:    { label: 'Done',    color: '#065f46', bg: '#d1fae5' },
  rejected:{ label: 'Rejected',color: '#991b1b', bg: '#fee2e2' },
};

const PRIORITY_COLORS: Record<TaskItem['priority'], string> = {
  high:   '#ef4444',
  medium: '#f97316',
  low:    '#94a3b8',
};

function isOverdue(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

interface ItemRowProps {
  item: TaskItem;
  onUpdateItem?: (id: string, patch: Partial<TaskItem>) => void;
}

function ItemRow({ item, onUpdateItem }: ItemRowProps) {
  const [hovered, setHovered] = useState(false);
  const meta = STATUS_META[item.status];
  const overdue = item.dueDate && item.status === 'pending' ? isOverdue(item.dueDate) : false;
  const isDone = item.status === 'done' || item.status === 'acked';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid #f1f5f9',
        opacity: isDone ? 0.65 : 1,
      }}
    >
      {/* Priority dot */}
      <span
        title={`Priority: ${item.priority}`}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: PRIORITY_COLORS[item.priority],
          flexShrink: 0,
        }}
      />

      {/* Status toggle */}
      <button
        type="button"
        title={`Status: ${item.status}${onUpdateItem ? ' — click to toggle done' : ''}`}
        onClick={() => {
          if (!onUpdateItem) return;
          const next: TaskItem['status'] = item.status === 'done' ? 'pending' : 'done';
          onUpdateItem(item.id, { status: next });
        }}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${meta.color}`,
          background: isDone ? meta.color : 'transparent',
          cursor: onUpdateItem ? 'pointer' : 'default',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        {isDone && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <polyline points="2,5 4,7.5 8,2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Text */}
      <span style={{
        flex: 1,
        fontSize: 13,
        color: isDone ? '#94a3b8' : '#1e293b',
        textDecoration: isDone ? 'line-through' : 'none',
        lineHeight: 1.4,
      }}>
        {item.text || <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>Untitled item</span>}
      </span>

      {/* Assignee */}
      {item.assignee && (
        <span
          title={item.assignee}
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#e0e7ff',
            color: '#4338ca',
            fontSize: 9,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {getInitials(item.assignee)}
        </span>
      )}

      {/* Due date */}
      {item.dueDate && (
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: 10,
          background: overdue ? '#fef2f2' : '#f0f9ff',
          color: overdue ? '#dc2626' : '#64748b',
          border: overdue ? '1px solid #fecaca' : '1px solid #e0f2fe',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          {overdue ? '⚠ ' : ''}{formatDate(item.dueDate)}
        </span>
      )}

      {/* Quick-update dropdown — visible on hover */}
      {onUpdateItem && hovered && (
        <select
          value={item.status}
          onChange={(e) => onUpdateItem(item.id, { status: e.target.value as TaskItem['status'] })}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 10,
            padding: '1px 4px',
            borderRadius: 6,
            border: `1px solid ${meta.color}`,
            background: meta.bg,
            color: meta.color,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          <option value="pending">pending</option>
          <option value="acked">acked</option>
          <option value="done">done</option>
          <option value="rejected">rejected</option>
        </select>
      )}
    </div>
  );
}

export default function TasksReaderRenderer({ section, onUpdateItem, onNavigateToEditor }: SectionRendererProps) {
  const items = section.items;

  if (items.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13, padding: '4px 0' }}>
        No items.
      </div>
    );
  }

  const pending  = items.filter(i => i.status === 'pending');
  const done     = items.filter(i => i.status === 'done' || i.status === 'acked');
  const rejected = items.filter(i => i.status === 'rejected');

  return (
    <div>
      {pending.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {pending.map(item => (
            <ItemRow key={item.id} item={item} onUpdateItem={onUpdateItem} />
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {done.map(item => (
            <ItemRow key={item.id} item={item} onUpdateItem={onUpdateItem} />
          ))}
        </div>
      )}
      {rejected.length > 0 && (
        <div>
          {rejected.map(item => (
            <ItemRow key={item.id} item={item} onUpdateItem={onUpdateItem} />
          ))}
        </div>
      )}

      {onNavigateToEditor && (
        <button
          type="button"
          onClick={() => onNavigateToEditor(section.id)}
          style={{
            marginTop: 6,
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
