// frontend/src/components/doc-editor/VersionHistoryPanel.tsx
//
// Slide-out sidebar for browsing, previewing, and restoring document versions.

import type { VersionEntry } from '../../hooks/useVersionHistory';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VersionHistoryPanelProps {
  versions: VersionEntry[];
  loading: boolean;
  previewTimestamp: number | null;
  onFetch: () => void;
  onPreview: (timestamp: number) => void;
  onRestore: (timestamp: number) => void;
  onClearPreview: () => void;
  onClose: () => void;
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
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  width: 320,
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

const versionItemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 1rem',
  cursor: 'pointer',
  background: active ? '#eff6ff' : 'transparent',
  borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
  fontSize: 13,
  color: '#374151',
});

const timestampLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
};

const footerStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderTop: '1px solid #e5e7eb',
  flexShrink: 0,
};

const restoreBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: '#3b82f6',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
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
  onRestore,
  onClearPreview,
  onClose,
}: VersionHistoryPanelProps) {
  const handleRestore = () => {
    if (previewTimestamp == null) return;
    const confirmed = window.confirm(
      'Restore this version? The current document will be replaced with this snapshot.',
    );
    if (confirmed) {
      onRestore(previewTimestamp);
      onClearPreview();
    }
  };

  const handleClose = () => {
    onClearPreview();
    onClose();
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h3 style={titleStyle}>Version History</h3>
        <button type="button" style={closeBtnStyle} onClick={handleClose}>
          ✕
        </button>
      </div>

      {/* Version list */}
      <div style={listStyle}>
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
              <span>{formatRelativeTime(v.age)}</span>
              <span style={timestampLabel}>
                {new Date(v.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
      </div>

      {/* Footer: restore button */}
      {previewTimestamp != null && (
        <div style={footerStyle}>
          <button type="button" style={restoreBtnStyle} onClick={handleRestore}>
            Restore this version
          </button>
        </div>
      )}
    </div>
  );
}
