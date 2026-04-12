// frontend/src/components/doc-editor/DocumentHeader.tsx
//
// Header bar with title, status, mode selector, participants, and export menu.

import { useState } from 'react';
import type { ViewMode, DocumentMeta, Participant } from '../../types/document';
import ParticipantAvatars from './ParticipantAvatars';

interface DocumentHeaderProps {
  meta: DocumentMeta;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  participants: Participant[];
  onUpdateMeta: (patch: Partial<DocumentMeta>) => void;
  onExport: (format: 'markdown' | 'pdf' | 'json') => void;
  onToggleHistory: () => void;
  onClearDocument: () => void;
  onJumpToUser?: (participant: Participant) => void;
  sections?: { id: string; title: string }[];
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  background: '#fff',
  borderBottom: '1px solid #e5e7eb',
  flexShrink: 0,
};

const leftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flex: 1,
};

const centerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

const rightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flex: 1,
  justifyContent: 'flex-end',
};

const titleInput: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  border: '1px solid transparent',
  borderRadius: 4,
  padding: '4px 8px',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  minWidth: 180,
  color: '#111827',
};

const statusBadge = (status: DocumentMeta['status']): React.CSSProperties => {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#fef3c7', text: '#92400e' },
    review: { bg: '#dbeafe', text: '#1e40af' },
    final: { bg: '#d1fae5', text: '#065f46' },
  };
  const c = colors[status] ?? colors.draft;
  return {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 10px',
    borderRadius: 9999,
    background: c.bg,
    color: c.text,
  };
};

const modeLabels: { mode: ViewMode; label: string }[] = [
  { mode: 'editor', label: 'Editor' },
  { mode: 'ack', label: 'Review' },
  { mode: 'reader', label: 'Read' },
];

const modeBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  cursor: 'pointer',
  background: active ? '#3b82f6' : '#fff',
  color: active ? '#fff' : '#374151',
  fontFamily: 'inherit',
});

const exportBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontFamily: 'inherit',
  position: 'relative',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 50,
  minWidth: 140,
  overflow: 'hidden',
};

const dropdownItem: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 14px',
  fontSize: 13,
  border: 'none',
  background: 'transparent',
  color: '#374151',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default function DocumentHeader({
  meta,
  mode,
  onModeChange,
  participants,
  onUpdateMeta,
  onExport,
  onToggleHistory,
  onClearDocument,
  onJumpToUser,
  sections,
}: DocumentHeaderProps) {
  const [showExport, setShowExport] = useState(false);

  return (
    <header style={headerStyle}>
      {/* Left: title + status */}
      <div style={leftStyle}>
        <input
          style={titleInput}
          value={meta.title}
          placeholder="Untitled document"
          onChange={(e) => onUpdateMeta({ title: e.target.value })}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor = '#3b82f6';
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = 'transparent';
          }}
        />
        <span style={statusBadge(meta.status)}>{meta.status}</span>
        {mode === 'editor' && (
          <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
            Auto-saved
          </span>
        )}
      </div>

      {/* Center: mode selector */}
      <div style={centerStyle}>
        {modeLabels.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            style={modeBtnStyle(mode === m)}
            onClick={() => onModeChange(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Right: participants + export */}
      <div style={rightStyle}>
        <ParticipantAvatars participants={participants} sections={sections} onJumpToUser={onJumpToUser} />
        <button
          type="button"
          style={{
            ...exportBtnStyle,
            color: '#dc2626',
            border: '1px solid #fca5a5',
          }}
          onClick={() => {
            if (window.confirm('Clear all document content? This cannot be undone.')) {
              onClearDocument();
            }
          }}
        >
          Clear
        </button>
        <button
          type="button"
          style={exportBtnStyle}
          onClick={onToggleHistory}
        >
          History
        </button>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            style={exportBtnStyle}
            onClick={() => setShowExport((v) => !v)}
          >
            Export
          </button>
          {showExport && (
            <div style={dropdownStyle}>
              {(['markdown', 'pdf', 'json'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  style={dropdownItem}
                  onClick={() => {
                    onExport(fmt);
                    setShowExport(false);
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = '#f3f4f6';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
