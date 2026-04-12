// frontend/src/components/doc-editor/AckMode.tsx
//
// Sequential chunk review mode. User navigates through sections one at a time.

import { useState, useEffect } from 'react';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, Participant, CommentThread } from '../../types/document';
import type { CollaborationProvider } from './TiptapEditor';
import ReviewProgress from './ReviewProgress';
import ChunkViewer from './ChunkViewer';

interface AckModeProps {
  sections: Section[];
  onAckItem: (sectionId: string, itemId: string, notes?: string) => void;
  onRejectItem: (sectionId: string, itemId: string, reason: string) => void;
  participants: Participant[];
  onSectionFocus?: (sectionId: string) => void;
  /** Jump to a specific section page (set by handleJumpToUser) */
  jumpToIndex?: number | null;
  onJumpComplete?: () => void;
  getSectionFragment: (sectionId: string) => XmlFragment | null;
  ydoc: Y.Doc;
  provider: CollaborationProvider | null;
  comments?: Record<string, CommentThread[]>;
  onAddComment?: (sectionId: string, text: string, parentCommentId?: string | null) => void;
  onResolveThread?: (sectionId: string, commentId: string) => void;
  onUnresolveThread?: (sectionId: string, commentId: string) => void;
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '1rem',
  padding: '0.75rem 0',
};

const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 18px',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: disabled ? '#f9fafb' : '#fff',
  color: disabled ? '#9ca3af' : '#374151',
  cursor: disabled ? 'default' : 'pointer',
});

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '3rem',
  color: '#6b7280',
  fontSize: 15,
};

const SECTIONS_PER_PAGE = 4;

export default function AckMode({ sections, onAckItem, onRejectItem, participants, onSectionFocus, jumpToIndex, onJumpComplete, getSectionFragment, ydoc, provider, comments, onAddComment, onResolveThread, onUnresolveThread }: AckModeProps) {
  const [pageIndex, setPageIndex] = useState(0);

  const totalPages = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));
  const startIdx = pageIndex * SECTIONS_PER_PAGE;
  const pageSections = sections.slice(startIdx, startIdx + SECTIONS_PER_PAGE);

  // Handle jump-to-index from handleJumpToUser
  useEffect(() => {
    if (jumpToIndex != null && jumpToIndex >= 0 && jumpToIndex < sections.length) {
      setPageIndex(Math.floor(jumpToIndex / SECTIONS_PER_PAGE));
      onJumpComplete?.();
    }
  }, [jumpToIndex, sections.length, onJumpComplete]);

  // Update awareness when the first visible section changes
  useEffect(() => {
    if (pageSections.length > 0 && onSectionFocus) {
      onSectionFocus(pageSections[0].id);
    }
  }, [startIdx, onSectionFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sections.length === 0) {
    return <div style={emptyStyle}>No sections to review.</div>;
  }

  const prev = () => setPageIndex((i) => Math.max(0, i - 1));
  const next = () => setPageIndex((i) => Math.min(totalPages - 1, i + 1));
  const reviewedCount = startIdx + pageSections.length;

  return (
    <div>
      <ReviewProgress current={reviewedCount} total={sections.length} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pageSections.map((section) => {
          const sectionParticipants = participants?.filter(p => p.currentSectionId === section.id) ?? [];
          return (
            <div key={section.id}>
              {sectionParticipants.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#6b7280', marginRight: 4 }}>Viewing:</span>
                  {sectionParticipants.map(p => (
                    <div key={p.clientId} title={`${p.displayName} (${p.mode})`} style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: p.color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 600,
                    }}>
                      {p.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                  ))}
                </div>
              )}

              <ChunkViewer
                section={section}
                onAckItem={(itemId, notes) => onAckItem(section.id, itemId, notes)}
                onRejectItem={(itemId, reason) => onRejectItem(section.id, itemId, reason)}
                fragment={getSectionFragment(section.id)}
                ydoc={ydoc}
                provider={provider}
                comments={comments?.[section.id]}
                onAddComment={onAddComment ? (text, parentCommentId) => onAddComment(section.id, text, parentCommentId) : undefined}
                onResolveThread={onResolveThread ? (commentId) => onResolveThread(section.id, commentId) : undefined}
                onUnresolveThread={onUnresolveThread ? (commentId) => onUnresolveThread(section.id, commentId) : undefined}
                participants={sectionParticipants}
              />
            </div>
          );
        })}
      </div>

      <div style={navStyle}>
        <button
          type="button"
          style={navBtnStyle(pageIndex === 0)}
          onClick={prev}
          disabled={pageIndex === 0}
        >
          Previous
        </button>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Page {pageIndex + 1} of {totalPages} ({sections.length} sections)
        </span>
        <button
          type="button"
          style={navBtnStyle(pageIndex === totalPages - 1)}
          onClick={next}
          disabled={pageIndex === totalPages - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
