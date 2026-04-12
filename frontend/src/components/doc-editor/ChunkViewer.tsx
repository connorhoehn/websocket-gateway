// frontend/src/components/doc-editor/ChunkViewer.tsx
//
// Renders a single section chunk for ack-mode review.

import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, CommentThread, Participant } from '../../types/document';
import TiptapEditor from './TiptapEditor';
import type { CollaborationProvider } from './TiptapEditor';
import ReviewableItem from './ReviewableItem';
import SectionComments from './SectionComments';

interface ChunkViewerProps {
  section: Section;
  onAckItem: (itemId: string, notes?: string) => void;
  onRejectItem: (itemId: string, reason: string) => void;
  fragment: XmlFragment | null;
  ydoc: Y.Doc;
  provider: CollaborationProvider | null;
  comments?: CommentThread[];
  onAddComment?: (text: string, parentCommentId?: string | null) => void;
  onResolveThread?: (commentId: string) => void;
  onUnresolveThread?: (commentId: string) => void;
  participants?: Participant[];
}

const typeBadgeColors: Record<Section['type'], { bg: string; text: string }> = {
  summary: { bg: '#dbeafe', text: '#1e40af' },
  tasks: { bg: '#fef3c7', text: '#92400e' },
  decisions: { bg: '#ede9fe', text: '#5b21b6' },
  notes: { bg: '#f3f4f6', text: '#374151' },
  custom: { bg: '#e0e7ff', text: '#3730a3' },
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '1.25rem',
  marginBottom: '1rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  margin: 0,
  marginBottom: 4,
  color: '#1e293b',
};

const badgeStyle = (bg: string, text: string): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 10px',
  borderRadius: 9999,
  background: bg,
  color: text,
  marginBottom: 12,
});

const statsStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  marginTop: 12,
  paddingTop: 8,
  borderTop: '1px solid #f3f4f6',
};

export default function ChunkViewer({ section, onAckItem, onRejectItem, fragment, ydoc, provider, comments, onAddComment, onResolveThread, onUnresolveThread, participants }: ChunkViewerProps) {
  const tc = typeBadgeColors[section.type] ?? typeBadgeColors.custom;
  const reviewed = section.items.filter((i) => i.status !== 'pending').length;

  return (
    <div style={cardStyle}>
      <h2 style={titleStyle}>{section.title}</h2>
      <span style={badgeStyle(tc.bg, tc.text)}>{section.type}</span>

      {/* Rich-text content (read-only) */}
      {fragment && (
        <div style={{ marginBottom: section.items.length > 0 ? 16 : 0 }}>
          <TiptapEditor
            fragment={fragment}
            ydoc={ydoc}
            provider={provider}
            user={{ name: '', color: '' }}
            editable={false}
            sectionId={section.id}
          />
        </div>
      )}

      {/* No content at all */}
      {!fragment && section.items.length === 0 && (
        <div style={{ padding: '1.5rem 0', color: '#94a3b8', fontSize: 14, textAlign: 'center' }}>
          This {section.type} section has no content. Switch to Editor mode to add content.
        </div>
      )}

      {section.items.length > 0 && (
        <div>
          {section.items.map((item) => (
            <ReviewableItem
              key={item.id}
              item={item}
              onAck={(notes) => onAckItem(item.id, notes)}
              onReject={(reason) => onRejectItem(item.id, reason)}
            />
          ))}
          <div style={statsStyle}>
            {reviewed} of {section.items.length} items reviewed
          </div>
        </div>
      )}

      {onAddComment && (
        <SectionComments
          comments={comments ?? []}
          onAddComment={onAddComment}
          participants={participants}
          onResolveThread={onResolveThread}
          onUnresolveThread={onUnresolveThread}
        />
      )}
    </div>
  );
}
