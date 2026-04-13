// frontend/src/components/doc-editor/DiffViewer.tsx
//
// Visual diff between two document snapshots (current vs historical).
// Shows per-section changes: added, removed, modified sections and items.

import type { SnapshotSection } from '../../hooks/useVersionHistory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  /** Sections from the historical (older) version. */
  oldSections: SnapshotSection[];
  /** Sections from the current (newer) version. */
  newSections: SnapshotSection[];
  /** Called when the user dismisses the diff view. */
  onClose: () => void;
}

type SectionDiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

interface ItemDiff {
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  oldItem?: SnapshotSection['items'][number];
  newItem?: SnapshotSection['items'][number];
  changes: string[];
}

interface SectionDiff {
  status: SectionDiffStatus;
  id: string;
  oldTitle?: string;
  newTitle?: string;
  titleChanged: boolean;
  textChanged?: boolean;
  oldTextContent?: string;
  newTextContent?: string;
  itemDiffs: ItemDiff[];
}

// ---------------------------------------------------------------------------
// Diffing logic
// ---------------------------------------------------------------------------

function diffItems(
  oldItems: SnapshotSection['items'],
  newItems: SnapshotSection['items'],
): ItemDiff[] {
  const oldMap = new Map(oldItems.map(i => [i.id, i]));
  const newMap = new Map(newItems.map(i => [i.id, i]));
  const result: ItemDiff[] = [];

  // Check items in old list
  for (const old of oldItems) {
    const cur = newMap.get(old.id);
    if (!cur) {
      result.push({ status: 'removed', oldItem: old, changes: [] });
    } else {
      const changes: string[] = [];
      if (old.text !== cur.text) changes.push('text');
      if (old.status !== cur.status) changes.push(`status: ${old.status} -> ${cur.status}`);
      if (old.assignee !== cur.assignee) changes.push(`assignee: "${old.assignee}" -> "${cur.assignee}"`);
      if (old.priority !== cur.priority) changes.push(`priority: ${old.priority} -> ${cur.priority}`);

      if (changes.length > 0) {
        result.push({ status: 'modified', oldItem: old, newItem: cur, changes });
      } else {
        result.push({ status: 'unchanged', oldItem: old, newItem: cur, changes: [] });
      }
    }
  }

  // Check for added items
  for (const cur of newItems) {
    if (!oldMap.has(cur.id)) {
      result.push({ status: 'added', newItem: cur, changes: [] });
    }
  }

  return result;
}

function diffSections(
  oldSections: SnapshotSection[],
  newSections: SnapshotSection[],
): SectionDiff[] {
  const oldMap = new Map(oldSections.map(s => [s.id, s]));
  const newMap = new Map(newSections.map(s => [s.id, s]));
  const result: SectionDiff[] = [];

  // Check old sections
  for (const old of oldSections) {
    const cur = newMap.get(old.id);
    if (!cur) {
      result.push({
        status: 'removed',
        id: old.id,
        oldTitle: old.title,
        titleChanged: false,
        itemDiffs: old.items.map(i => ({ status: 'removed' as const, oldItem: i, changes: [] })),
      });
    } else {
      const titleChanged = old.title !== cur.title;
      const textChanged = (old.textContent || '') !== (cur.textContent || '');
      const itemDiffs = diffItems(old.items, cur.items);
      const hasChanges = titleChanged || textChanged || itemDiffs.some(d => d.status !== 'unchanged');
      result.push({
        status: hasChanges ? 'modified' : 'unchanged',
        id: old.id,
        oldTitle: old.title,
        newTitle: cur.title,
        titleChanged,
        textChanged,
        oldTextContent: old.textContent,
        newTextContent: cur.textContent,
        itemDiffs,
      });
    }
  }

  // Added sections
  for (const cur of newSections) {
    if (!oldMap.has(cur.id)) {
      result.push({
        status: 'added',
        id: cur.id,
        newTitle: cur.title,
        titleChanged: false,
        itemDiffs: cur.items.map(i => ({ status: 'added' as const, newItem: i, changes: [] })),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  background: '#fafbfc',
  maxHeight: 400,
  overflow: 'auto',
  padding: '0.75rem 1rem',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
};

const diffTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  margin: 0,
};

const closeDiffBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 12,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  color: '#6b7280',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const statusColors: Record<SectionDiffStatus | 'added' | 'removed' | 'modified' | 'unchanged', string> = {
  added: '#dcfce7',
  removed: '#fee2e2',
  modified: '#fef9c3',
  unchanged: 'transparent',
};

const statusBorderColors: Record<string, string> = {
  added: '#86efac',
  removed: '#fca5a5',
  modified: '#fde047',
  unchanged: '#e5e7eb',
};

const sectionBlockStyle = (status: SectionDiffStatus): React.CSSProperties => ({
  background: statusColors[status],
  border: `1px solid ${statusBorderColors[status]}`,
  borderRadius: 6,
  padding: '8px 10px',
  marginBottom: 6,
});

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const badgeStyle = (status: string): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  padding: '1px 6px',
  borderRadius: 3,
  color: status === 'added' ? '#166534' : status === 'removed' ? '#991b1b' : status === 'modified' ? '#854d0e' : '#6b7280',
  background: status === 'added' ? '#bbf7d0' : status === 'removed' ? '#fecaca' : status === 'modified' ? '#fef08a' : '#f3f4f6',
});

const itemRowStyle = (status: string): React.CSSProperties => ({
  fontSize: 12,
  padding: '3px 8px',
  borderRadius: 3,
  marginTop: 2,
  background: status === 'added' ? '#dcfce7' : status === 'removed' ? '#fee2e2' : status === 'modified' ? '#fef9c3' : 'transparent',
  color: status === 'added' ? '#166534' : status === 'removed' ? '#991b1b' : status === 'modified' ? '#854d0e' : '#374151',
  textDecoration: status === 'removed' ? 'line-through' : 'none',
});

const changeDetailStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#92400e',
  marginLeft: 16,
  fontStyle: 'italic',
};

const noChangesStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#9ca3af',
  textAlign: 'center',
  padding: '1rem',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiffViewer({ oldSections, newSections, onClose }: DiffViewerProps) {
  const diffs = diffSections(oldSections, newSections);
  const hasChanges = diffs.some(d => d.status !== 'unchanged');

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        <h4 style={diffTitleStyle}>Changes from selected version to current</h4>
        <button type="button" style={closeDiffBtnStyle} onClick={onClose}>
          Dismiss
        </button>
      </div>

      {!hasChanges && (
        <div style={noChangesStyle}>No differences found. The documents are identical.</div>
      )}

      {diffs
        .filter(d => d.status !== 'unchanged')
        .map((sd) => (
          <div key={sd.id} style={sectionBlockStyle(sd.status)}>
            <div style={sectionHeaderStyle}>
              <span style={badgeStyle(sd.status)}>{sd.status}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                {sd.status === 'removed' ? sd.oldTitle : sd.newTitle ?? sd.oldTitle}
              </span>
              {sd.titleChanged && (
                <span style={{ fontSize: 11, color: '#92400e' }}>
                  (was: "{sd.oldTitle}")
                </span>
              )}
            </div>

            {/* Item-level diffs */}
            {sd.itemDiffs
              .filter(d => d.status !== 'unchanged')
              .map((id, idx) => {
                const item = id.newItem ?? id.oldItem;
                return (
                  <div key={item?.id ?? idx}>
                    <div style={itemRowStyle(id.status)}>
                      {id.status === 'added' && '+ '}
                      {id.status === 'removed' && '- '}
                      {id.status === 'modified' && '~ '}
                      {item?.text ?? '(untitled)'}
                      {item?.assignee ? ` [${item.assignee}]` : ''}
                    </div>
                    {id.changes.length > 0 && (
                      <div style={changeDetailStyle}>
                        {id.changes.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Text content diff */}
            {sd.textChanged && (
              <div style={{ marginTop: 4, fontSize: 12 }}>
                {sd.oldTextContent && (
                  <div style={{ padding: '4px 8px', borderRadius: 3, background: '#fee2e2', color: '#991b1b', textDecoration: 'line-through', marginBottom: 2 }}>
                    {sd.oldTextContent.substring(0, 200)}{(sd.oldTextContent?.length ?? 0) > 200 ? '...' : ''}
                  </div>
                )}
                {sd.newTextContent && (
                  <div style={{ padding: '4px 8px', borderRadius: 3, background: '#dcfce7', color: '#166534' }}>
                    {sd.newTextContent.substring(0, 200)}{(sd.newTextContent?.length ?? 0) > 200 ? '...' : ''}
                  </div>
                )}
              </div>
            )}

            {sd.status === 'modified' && !sd.textChanged && sd.itemDiffs.every(d => d.status === 'unchanged') && sd.titleChanged && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                Only the section title changed.
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
