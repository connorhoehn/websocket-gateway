// frontend/src/components/doc-editor/VersionHistoryPanel.tsx
//
// Slide-out sidebar for browsing and comparing document versions (view-only).

import type { VersionEntry, SnapshotSection } from '../../hooks/useVersionHistory';
import { Panel, PanelHeader, PanelBody, Button } from '../ui/Panel';
import { colors, fontSize as fs, borderRadius } from '../../styles/tokens';
import DiffViewer from './DiffViewer';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VersionHistoryPanelProps {
  versions: VersionEntry[];
  loading: boolean;
  previewTimestamp: number | null;
  onFetch: () => void;
  onPreview: (timestamp: number) => void;
  onClearPreview: () => void;
  onClose: () => void;
  /** Save a named version. */
  onSaveVersion: (name: string) => void;
  /** Trigger comparison for a version timestamp. */
  onCompare: (timestamp: number) => void;
  /** Dismiss the diff view. */
  onClearCompare: () => void;
  /** Sections from the compared historical version (null when no compare active). */
  compareSections: SnapshotSection[] | null;
  /** Currently compared timestamp. */
  compareTimestamp: number | null;
  /** Current document sections for diff. */
  currentSections: SnapshotSection[];
  /** Restore to a historical version. */
  onRestore?: (timestamp: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(ms: number): string {
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

// ---------------------------------------------------------------------------
// Styles (kept: list-item-level styles not covered by shared components)
// ---------------------------------------------------------------------------

const emptyStyle: React.CSSProperties = {
  padding: '2rem 1rem',
  textAlign: 'center',
  color: colors.textMuted,
  fontSize: fs.sm,
};

const versionItemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 1rem',
  cursor: 'pointer',
  background: active ? '#eff6ff' : 'transparent',
  borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
  fontSize: fs.sm,
  color: colors.textPrimary,
});

const timestampLabel: React.CSSProperties = {
  fontSize: fs.xs,
  color: colors.textMuted,
};

const versionNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#1f2937',
  display: 'block',
  marginBottom: 1,
};

const versionTypeBadge = (type?: string): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 500,
  padding: '1px 5px',
  borderRadius: 3,
  marginLeft: 6,
  background: type === 'pre-restore' ? '#fef3c7' : type === 'auto' ? '#f3f4f6' : '#e0f2fe',
  color: type === 'pre-restore' ? '#92400e' : type === 'auto' ? colors.textMuted : '#0369a1',
});

const authorStyle: React.CSSProperties = {
  fontSize: 10,
  color: colors.textMuted,
  display: 'block',
};

const compareBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: fs.xs,
  fontWeight: 500,
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  background: colors.surface,
  color: '#6b7280',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VersionHistoryPanel({
  versions,
  loading,
  previewTimestamp,
  onFetch: _onFetch,
  onPreview,
  onClearPreview,
  onClose,
  onSaveVersion,
  onCompare,
  onClearCompare,
  compareSections,
  compareTimestamp,
  currentSections,
  onRestore,
}: VersionHistoryPanelProps) {
  const handleClose = () => {
    onClearPreview();
    onClearCompare();
    onClose();
  };

  const handleSaveVersion = () => {
    const name = window.prompt('Enter a name for this version:');
    if (name && name.trim()) {
      onSaveVersion(name.trim());
    }
  };

  const handleCompare = (e: React.MouseEvent, timestamp: number) => {
    e.stopPropagation(); // Don't trigger the row's preview click
    if (compareTimestamp === timestamp) {
      onClearCompare();
    } else {
      onCompare(timestamp);
    }
  };

  const versionTypeLabel = (v: VersionEntry): string => {
    if (v.type === 'pre-restore') return 'Before restore';
    if (v.type === 'auto') return 'Auto-save';
    return '';
  };

  return (
    <Panel width={320}>
      {/* Header */}
      <PanelHeader
        title="Version History"
        onClose={handleClose}
        actions={
          <Button size="sm" onClick={handleSaveVersion}>
            Save Version
          </Button>
        }
      />

      {/* Version list */}
      <PanelBody padding="0.5rem 0">
        {loading && <div style={emptyStyle}>Loading...</div>}

        {!loading && versions.length === 0 && (
          <div style={emptyStyle}>No saved versions yet</div>
        )}

        {!loading &&
          versions.map((v) => (
            <div
              key={v.timestamp}
              style={versionItemStyle(previewTimestamp === v.timestamp)}
              onClick={() => onPreview(v.timestamp)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {v.name && <span style={versionNameStyle}>{v.name}</span>}
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {formatRelativeTime(v.age)}
                  {v.type && v.type !== 'manual' && (
                    <span style={versionTypeBadge(v.type)}>
                      {versionTypeLabel(v)}
                    </span>
                  )}
                </span>
                {v.author && <span style={authorStyle}>by {v.author}</span>}
                <span style={timestampLabel}>
                  {new Date(v.timestamp).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                style={{
                  ...compareBtnStyle,
                  ...(compareTimestamp === v.timestamp
                    ? { background: '#eff6ff', borderColor: '#3b82f6', color: '#3b82f6' }
                    : {}),
                }}
                onClick={(e) => handleCompare(e, v.timestamp)}
              >
                {compareTimestamp === v.timestamp ? 'Hide Diff' : 'Compare'}
              </button>
            </div>
          ))}
      </PanelBody>

      {/* Diff viewer */}
      {compareSections != null && (
        <DiffViewer
          oldSections={compareSections}
          newSections={currentSections}
          onClose={onClearCompare}
        />
      )}

      {/* Restore button — shown when a version is selected for compare */}
      {onRestore && compareTimestamp != null && (
        <div style={{ padding: '0.75rem 1rem', borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
          <Button
            variant="primary"
            onClick={() => {
              if (window.confirm(
                'Restore this version?\n\n' +
                'A checkpoint of the current state will be saved first. ' +
                'All connected users will see the restored content. ' +
                'Comments and reviews added after this version may be lost.'
              )) {
                onRestore(compareTimestamp);
                onClearCompare();
              }
            }}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: borderRadius.lg,
            }}
          >
            Restore this version
          </Button>
          <div style={{ fontSize: fs.xs, color: colors.textMuted, textAlign: 'center', marginTop: 6 }}>
            A pre-restore checkpoint will be saved automatically
          </div>
        </div>
      )}

    </Panel>
  );
}
