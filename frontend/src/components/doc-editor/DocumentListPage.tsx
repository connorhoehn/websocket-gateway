// frontend/src/components/doc-editor/DocumentListPage.tsx
//
// Card-based list view of all documents in the workspace.
// Shows document metadata, presence avatars, and actions.

import { useState, useCallback } from 'react';
import NewDocumentModal from './NewDocumentModal';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface DocumentInfo {
  id: string;
  title: string;
  type: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  description?: string;
}

export interface PresenceInfo {
  userId: string;
  displayName: string;
  color: string;
  mode: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentListPageProps {
  documents: DocumentInfo[];
  presence: Record<string, PresenceInfo[]>; // documentId -> users in that doc
  onOpenDocument: (documentId: string) => void;
  onCreateDocument: (meta: { title: string; type: string; description?: string }) => void;
  onDeleteDocument: (documentId: string) => void;
  onJumpToUser: (documentId: string, userId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return '';

  const diffMs = now - then;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  draft: { bg: '#fef3c7', color: '#92400e' },
  review: { bg: '#dbeafe', color: '#1e40af' },
  final: { bg: '#d1fae5', color: '#065f46' },
  archived: { bg: '#f1f5f9', color: '#475569' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 9999,
        background: style.bg,
        color: style.color,
        textTransform: 'capitalize',
        lineHeight: '18px',
      }}
    >
      {status}
    </span>
  );
}

function PresenceAvatars({
  users,
  onClickUser,
}: {
  users: PresenceInfo[];
  onClickUser: (userId: string) => void;
}) {
  const MAX_SHOWN = 4;
  const shown = users.slice(0, MAX_SHOWN);
  const overflow = users.length - MAX_SHOWN;

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((u, i) => (
        <div
          key={u.userId}
          title={u.displayName}
          onClick={(e) => {
            e.stopPropagation();
            onClickUser(u.userId);
          }}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: u.color,
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #ffffff',
            marginLeft: i > 0 ? -8 : 0,
            cursor: 'pointer',
            position: 'relative',
            zIndex: MAX_SHOWN - i,
          }}
        >
          {u.displayName
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#94a3b8',
            color: '#ffffff',
            fontSize: 10,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #ffffff',
            marginLeft: -8,
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DocumentListPage({
  documents,
  presence,
  onOpenDocument,
  onCreateDocument,
  onDeleteDocument,
  onJumpToUser,
}: DocumentListPageProps) {
  const [showModal, setShowModal] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const handleDelete = useCallback(
    (e: React.MouseEvent, docId: string, title: string) => {
      e.stopPropagation();
      if (window.confirm(`Delete "${title}"? This cannot be undone.`)) {
        onDeleteDocument(docId);
      }
    },
    [onDeleteDocument],
  );

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 16px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1e293b' }}>Documents</h1>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            fontSize: 14,
            fontWeight: 600,
            border: 'none',
            borderRadius: 8,
            background: '#3b82f6',
            color: '#ffffff',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          New Document
        </button>
      </div>

      {/* Document cards */}
      {documents.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 16px',
            color: '#94a3b8',
            fontSize: 15,
          }}
        >
          No documents yet. Create your first document to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {documents.map((doc) => {
            const users = presence[doc.id] ?? [];
            const isHovered = hoveredCard === doc.id;

            return (
              <div
                key={doc.id}
                onClick={() => onOpenDocument(doc.id)}
                onMouseEnter={() => setHoveredCard(doc.id)}
                onMouseLeave={() => setHoveredCard(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '14px 16px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'box-shadow 0.15s',
                  boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {/* Icon */}
                <span style={{ fontSize: 24, flexShrink: 0 }}>{doc.icon}</span>

                {/* Left: metadata */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: '#1e293b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.title}
                    </span>
                    <StatusBadge status={doc.status} />
                  </div>
                  {doc.description && (
                    <div
                      style={{
                        fontSize: 13,
                        color: '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginBottom: 2,
                      }}
                    >
                      {doc.description}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Updated {relativeTime(doc.updatedAt)}
                  </div>
                </div>

                {/* Right: presence */}
                {users.length > 0 && (
                  <div style={{ flexShrink: 0 }}>
                    <PresenceAvatars
                      users={users}
                      onClickUser={(uid) => onJumpToUser(doc.id, uid)}
                    />
                  </div>
                )}

                {/* Delete button (hover-only) */}
                {isHovered && (
                  <button
                    onClick={(e) => handleDelete(e, doc.id, doc.title)}
                    title="Delete document"
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 22,
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      borderRadius: 4,
                      background: '#fee2e2',
                      color: '#dc2626',
                      fontSize: 14,
                      lineHeight: 1,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    &#215;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New document modal */}
      <NewDocumentModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={onCreateDocument}
      />
    </div>
  );
}
