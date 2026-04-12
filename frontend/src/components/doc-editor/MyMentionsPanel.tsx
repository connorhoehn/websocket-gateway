// frontend/src/components/doc-editor/MyMentionsPanel.tsx
//
// Slide-out sidebar showing the current user's @mentions and assigned tasks.

import { useState } from 'react';
import type { MyItem, MentionItem, TaskAssignment } from '../../hooks/useMyMentionsAndTasks';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MyMentionsPanelProps {
  items: MyItem[];
  onNavigateToSection: (sectionId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.now() - new Date(isoOrMs).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  width: 340,
  height: '100%',
  background: '#fff',
  borderLeft: '1px solid #e5e7eb',
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid #e5e7eb',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#111827',
  margin: 0,
};

const closeBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 16,
  fontWeight: 500,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1,
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  borderBottom: '1px solid #e5e7eb',
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '8px 0',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? '#3b82f6' : '#6b7280',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const listStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '0.5rem 0',
};

const emptyStyle: React.CSSProperties = {
  padding: '2rem 1rem',
  textAlign: 'center',
  color: '#9ca3af',
  fontSize: 13,
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '10px 1rem',
  cursor: 'pointer',
  borderBottom: '1px solid #f3f4f6',
  alignItems: 'flex-start',
};

const avatarStyle = (color: string): React.CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: color,
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

const itemBodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const commentTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#374151',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
  marginTop: 2,
};

const timestampStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
  flexShrink: 0,
  marginTop: 2,
};

const priorityDotStyle = (priority: string): React.CSSProperties => {
  const colors: Record<string, string> = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#22c55e',
  };
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: colors[priority] ?? '#9ca3af',
    flexShrink: 0,
    marginTop: 4,
  };
};

const statusBadgeStyle = (status: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: '#fef3c7', text: '#92400e' },
    acked: { bg: '#dbeafe', text: '#1e40af' },
    done: { bg: '#d1fae5', text: '#065f46' },
    rejected: { bg: '#fee2e2', text: '#991b1b' },
  };
  const c = colors[status] ?? colors.pending;
  return {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 9999,
    background: c.bg,
    color: c.text,
    marginLeft: 6,
  };
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MentionRow({
  item,
  onClick,
  onDismiss,
}: {
  item: MentionItem;
  onClick: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={itemStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = '#f9fafb';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <div style={avatarStyle(item.authorColor)}>
        {getInitials(item.authorName)}
      </div>
      <div style={itemBodyStyle}>
        <div style={commentTextStyle}>{item.commentText}</div>
        <div style={sectionLabelStyle}>{item.sectionTitle}</div>
      </div>
      <div style={timestampStyle}>{formatRelativeTime(item.timestamp)}</div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        aria-label="Dismiss mention"
        style={{
          padding: '2px 6px',
          fontSize: 13,
          color: '#9ca3af',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        x
      </button>
    </div>
  );
}

function TaskRow({
  item,
  onClick,
  onDismiss,
}: {
  item: TaskAssignment;
  onClick: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={itemStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = '#f9fafb';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <div style={priorityDotStyle(item.priority)} />
      <div style={itemBodyStyle}>
        <div style={commentTextStyle}>
          {item.taskText}
          <span style={statusBadgeStyle(item.status)}>{item.status}</span>
        </div>
        <div style={sectionLabelStyle}>{item.sectionTitle}</div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        aria-label="Dismiss task"
        style={{
          padding: '2px 6px',
          fontSize: 13,
          color: '#9ca3af',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        x
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'mentions' | 'tasks';

export default function MyMentionsPanel({
  items,
  onNavigateToSection,
  onClose,
}: MyMentionsPanelProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismissItem = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const clearAll = () => {
    const allIds = filtered.map(item => item.kind === 'mention' ? item.commentId : item.itemId);
    setDismissed(prev => {
      const next = new Set(prev);
      allIds.forEach(id => next.add(id));
      return next;
    });
  };

  const filtered = items.filter((item) => {
    const id = item.kind === 'mention' ? item.commentId : item.itemId;
    if (dismissed.has(id)) return false;
    if (filter === 'all') return true;
    if (filter === 'mentions') return item.kind === 'mention';
    return item.kind === 'task';
  });

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h3 style={titleStyle}>My Mentions &amp; Tasks</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 500,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#fff',
                color: '#6b7280',
                cursor: 'pointer',
                fontFamily: 'inherit',
                lineHeight: 1.2,
              }}
            >
              Clear all
            </button>
          )}
          <button type="button" style={closeBtnStyle} onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={tabBarStyle}>
        {(['all', 'mentions', 'tasks'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            style={tabStyle(filter === tab)}
            onClick={() => setFilter(tab)}
          >
            {tab === 'all' ? 'All' : tab === 'mentions' ? 'Mentions' : 'Tasks'}
          </button>
        ))}
      </div>

      {/* Item list */}
      <div style={listStyle}>
        {filtered.length === 0 && (
          <div style={emptyStyle}>No mentions or tasks for you</div>
        )}

        {filtered.map((item) =>
          item.kind === 'mention' ? (
            <MentionRow
              key={item.commentId}
              item={item}
              onClick={() => onNavigateToSection(item.sectionId)}
              onDismiss={() => dismissItem(item.commentId)}
            />
          ) : (
            <TaskRow
              key={item.itemId}
              item={item}
              onClick={() => onNavigateToSection(item.sectionId)}
              onDismiss={() => dismissItem(item.itemId)}
            />
          ),
        )}
      </div>
    </div>
  );
}
