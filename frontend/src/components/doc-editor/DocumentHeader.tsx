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
  onToggleVideoCall?: () => void;
  onToggleVideoHistory?: () => void;
  isCallActive?: boolean;
  onClearDocument: () => void;
  onJumpToUser?: (participant: Participant) => void;
  sections?: { id: string; title: string }[];
  onToggleMyItems?: () => void;
  myItemCount?: number;
  commentCount?: number;
  onBack?: () => void;
  onFollowUser?: (participant: Participant) => void;
  followingUserId?: string | null;
  onFinalize?: () => void;
  onUnlock?: () => void;
  pastCallsCount?: number;
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '0.5rem 1rem',
  background: '#fff',
  borderBottom: '1px solid #e5e7eb',
  flexShrink: 0,
  gap: 6,
  position: 'sticky',
  top: 53,
  zIndex: 34,
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
  gap: 8,
  flexWrap: 'wrap',
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
  onToggleVideoCall,
  onToggleVideoHistory,
  isCallActive,
  onClearDocument,
  onJumpToUser,
  sections,
  onToggleMyItems,
  myItemCount,
  commentCount,
  onBack,
  onFollowUser,
  followingUserId,
  onFinalize,
  onUnlock,
  pastCallsCount,
}: DocumentHeaderProps) {
  const [showMore, setShowMore] = useState(false);

  return (
    <header style={headerStyle}>
      {/* Row 1: breadcrumb + title + status + participants */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button onClick={onBack} style={{
              background: 'none', border: 'none', color: '#3b82f6',
              cursor: 'pointer', fontSize: 13, padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 4,
              fontFamily: 'inherit',
            }}>
              &larr; Documents
            </button>
          )}
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
          {meta.updatedAt && (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Last edited {(() => {
                const diff = Date.now() - new Date(meta.updatedAt).getTime();
                const mins = Math.floor(diff / 60000);
                if (mins < 1) return 'just now';
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                return `${Math.floor(hrs / 24)}d ago`;
              })()}
            </span>
          )}
          {commentCount != null && commentCount > 0 && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 10px',
              borderRadius: 9999,
              background: '#f3f4f6',
              color: '#6b7280',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {commentCount}
            </span>
          )}
        </div>
        {participants.length > 0 && (
          <ParticipantAvatars participants={participants} sections={sections} onJumpToUser={onJumpToUser} onFollowUser={onFollowUser} followingUserId={followingUserId} />
        )}
      </div>

      {/* Row 2: mode selector + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* My Items — always visible */}
          <button type="button" style={exportBtnStyle} onClick={onToggleMyItems}>
            My Items{myItemCount ? ` (${myItemCount})` : ''}
          </button>

          {/* Call button — always visible when available */}
          {onToggleVideoCall && (
            <button
              type="button"
              style={{
                ...exportBtnStyle,
                ...(isCallActive ? { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' } : {}),
              }}
              onClick={onToggleVideoCall}
            >
              {isCallActive ? 'In Call' : 'Call'}
            </button>
          )}

          {/* Finalize / Unlock */}
          {meta.status === 'final' ? (
            <button type="button" style={{ ...exportBtnStyle, background: '#f0fdf4', color: '#065f46', border: '1px solid #86efac' }} onClick={onUnlock}>
              Unlock
            </button>
          ) : (
            <button type="button" style={{ ...exportBtnStyle, background: '#f0fdf4', color: '#065f46', border: '1px solid #86efac' }} onClick={onFinalize}>
              Finalize
            </button>
          )}

          {/* ⋯ More — secondary actions + export */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              style={{ ...exportBtnStyle, letterSpacing: 1 }}
              onClick={() => setShowMore((v) => !v)}
              title="More actions"
            >
              ⋯
            </button>
            {showMore && (
              <div style={{ ...dropdownStyle, right: 0, minWidth: 160 }}>
                <button type="button" style={dropdownItem} onClick={() => { onToggleHistory(); setShowMore(false); }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f3f4f6'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  History
                </button>
                {onToggleVideoHistory && (pastCallsCount ?? 0) > 0 && (
                  <button type="button" style={dropdownItem} onClick={() => { onToggleVideoHistory(); setShowMore(false); }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f3f4f6'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  >
                    Past Calls ({pastCallsCount})
                  </button>
                )}
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                {(['markdown', 'pdf', 'json'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    style={dropdownItem}
                    onClick={() => { onExport(fmt); setShowMore(false); }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#f3f4f6'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  >
                    Export {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                  </button>
                ))}
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                <button type="button"
                  style={{ ...dropdownItem, color: '#dc2626' }}
                  onClick={() => { setShowMore(false); if (window.confirm('Clear all document content? This cannot be undone.')) onClearDocument(); }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#fff5f5'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                >
                  Clear Document
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
