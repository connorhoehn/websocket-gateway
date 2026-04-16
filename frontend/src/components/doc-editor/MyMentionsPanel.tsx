// frontend/src/components/doc-editor/MyMentionsPanel.tsx
//
// Slide-out sidebar showing the current user's @mentions and assigned tasks.

import { useState } from 'react';
import type { MyItem, MentionItem, TaskAssignment } from '../../hooks/useMyMentionsAndTasks';
import { Panel, PanelHeader, PanelBody, Button } from '../ui/Panel';
import { colors, fontSize } from '../../styles/tokens';

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
// Styles (item-level — panel/header/body handled by shared components)
// ---------------------------------------------------------------------------

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  borderBottom: `1px solid ${colors.border}`,
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '8px 0',
  fontSize: fontSize.sm,
  fontWeight: active ? 600 : 400,
  color: active ? colors.primary : colors.textSecondary,
  background: 'transparent',
  border: 'none',
  borderBottom: active ? `2px solid ${colors.primary}` : '2px solid transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const emptyStyle: React.CSSProperties = {
  padding: '2rem 1rem',
  textAlign: 'center',
  color: colors.textMuted,
  fontSize: fontSize.sm,
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
  fontSize: fontSize.xs,
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
  fontSize: fontSize.sm,
  color: colors.textPrimary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: fontSize.xs,
  color: colors.textMuted,
  marginTop: 2,
};

const timestampStyle: React.CSSProperties = {
  fontSize: fontSize.xs,
  color: colors.textMuted,
  flexShrink: 0,
  marginTop: 2,
};

const dismissBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: fontSize.sm,
  color: colors.textMuted,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  lineHeight: 1,
  flexShrink: 0,
};

const priorityDotStyle = (priority: string): React.CSSProperties => {
  const dotColors: Record<string, string> = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#22c55e',
  };
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: dotColors[priority] ?? colors.textMuted,
    flexShrink: 0,
    marginTop: 4,
  };
};

const statusBadgeStyle = (status: string): React.CSSProperties => {
  const badgeColors: Record<string, { bg: string; text: string }> = {
    pending: { bg: '#fef3c7', text: '#92400e' },
    acked: { bg: '#dbeafe', text: '#1e40af' },
    done: { bg: '#d1fae5', text: '#065f46' },
    rejected: { bg: '#fee2e2', text: '#991b1b' },
  };
  const c = badgeColors[status] ?? badgeColors.pending;
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
        style={dismissBtnStyle}
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
        style={dismissBtnStyle}
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
    <Panel width={340}>
      <PanelHeader
        title="My Mentions &amp; Tasks"
        onClose={onClose}
        actions={
          filtered.length > 0 ? (
            <Button variant="default" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          ) : undefined
        }
      />

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
      <PanelBody padding="0.5rem 0">
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
      </PanelBody>
    </Panel>
  );
}
