// frontend/src/components/CollapsedIconStrip.tsx
//
// Narrow icon-only sidebar shown when the main CollapsibleSidebar is
// collapsed. Replaces the previous "fully hidden + overlay hamburger"
// pattern with a persistent full-height column that surfaces:
//   - Expand button (☰) at the top
//   - Connection status dot
//   - Section icons (documents, pipelines, observability) — clickable to
//     navigate, with the assumption that landing on the section will give
//     the user the full UI without needing the sidebar expanded
//
// Width is 56px to match SIDEBAR_COLLAPSED_WIDTH in AppLayout.

import type { CSSProperties } from 'react';

type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface CollapsedIconStripProps {
  connectionState: ConnectionState;
  onExpand: () => void;
  onDocuments: () => void;
  onPipelines: () => void;
  onObservability: () => void;
}

const buttonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  color: '#475569',
  fontFamily: 'inherit',
  padding: 0,
  transition: 'background 0.15s ease',
};

const connectionDotStyle = (state: ConnectionState): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background:
    state === 'connected' ? '#22c55e'
    : state === 'connecting' || state === 'reconnecting' ? '#f59e0b'
    : '#ef4444',
  margin: '6px auto',
});

function IconButton({
  icon,
  title,
  onClick,
}: {
  icon: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      style={buttonStyle}
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {icon}
    </button>
  );
}

export function CollapsedIconStrip({
  connectionState,
  onExpand,
  onDocuments,
  onPipelines,
  onObservability,
}: CollapsedIconStripProps) {
  return (
    <div
      data-testid="collapsed-icon-strip"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        height: '100%',
      }}
    >
      <IconButton icon={'\u2630'} title="Expand sidebar" onClick={onExpand} />
      <div
        style={connectionDotStyle(connectionState)}
        title={`Connection: ${connectionState}`}
        aria-label={`Connection: ${connectionState}`}
      />
      <div style={{ height: 8 }} />
      <IconButton icon={'\u{1F4C4}'} title="Documents" onClick={onDocuments} />
      <IconButton icon={'\u{1F500}'} title="Pipelines" onClick={onPipelines} />
      <IconButton icon={'\u{1F4E1}'} title="Observability" onClick={onObservability} />
    </div>
  );
}

export default CollapsedIconStrip;
