// frontend/src/components/doc-editor/SectionList.tsx
//
// Renders all document sections in order.
// Sections are defined by the document type — not added ad-hoc here.

import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, TaskItem, Participant } from '../../types/document';
import SectionBlock from './SectionBlock';
import type { CollaborationProvider } from './TiptapEditor';
import type { CommentThread } from '../../types/document';

export interface SectionListProps {
  sections: Section[];
  getSectionFragment: (sectionId: string) => XmlFragment | null;
  ydoc: Y.Doc;
  provider: CollaborationProvider | null;
  user: { name: string; color: string };
  editable: boolean;
  onUpdateSection: (sectionId: string, patch: Partial<Section>) => void;
  onAddItem: (sectionId: string, item: Omit<TaskItem, 'id'>) => void;
  onUpdateItem: (sectionId: string, itemId: string, patch: Partial<TaskItem>) => void;
  onRemoveItem: (sectionId: string, itemId: string) => void;
  participants?: Participant[];
  onSectionFocus?: (sectionId: string) => void;
  focusedSectionId?: string | null;
  comments?: Record<string, CommentThread[]>;
  onAddComment?: (sectionId: string, text: string, parentCommentId?: string | null) => void;
  onResolveThread?: (sectionId: string, commentId: string) => void;
  onUnresolveThread?: (sectionId: string, commentId: string) => void;
  /** Merge-safe awareness updater for Tiptap cursor info. */
  onUpdateCursorInfo?: (name: string, color: string) => void;
  /** Called when user clicks a section's comment icon to open the sidebar. */
  onOpenComments?: (sectionId: string) => void;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  padding: '0 0 16px 0',
};

export default function SectionList({
  sections,
  getSectionFragment,
  ydoc,
  provider,
  user,
  editable,
  onUpdateSection,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  participants,
  onSectionFocus,
  focusedSectionId,
  comments,
  onAddComment,
  onResolveThread,
  onUnresolveThread,
  onUpdateCursorInfo,
  onOpenComments,
}: SectionListProps) {
  return (
    <div style={containerStyle}>
      {sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          fragment={getSectionFragment(section.id)}
          ydoc={ydoc}
          provider={provider}
          user={user}
          editable={editable}
          onUpdateSection={(patch) => onUpdateSection(section.id, patch)}
          onAddItem={(item) => onAddItem(section.id, item)}
          onUpdateItem={(itemId, patch) => onUpdateItem(section.id, itemId, patch)}
          onRemoveItem={(itemId) => onRemoveItem(section.id, itemId)}
          participants={participants?.filter(p => p.currentSectionId === section.id)}
          onFocus={() => onSectionFocus?.(section.id)}
          isFocused={focusedSectionId === section.id}
          comments={comments?.[section.id] ?? []}
          onAddComment={(text, parentCommentId) => onAddComment?.(section.id, text, parentCommentId)}
          onResolveThread={(commentId) => onResolveThread?.(section.id, commentId)}
          onUnresolveThread={(commentId) => onUnresolveThread?.(section.id, commentId)}
          onUpdateCursorInfo={onUpdateCursorInfo}
          commentCount={(comments?.[section.id] ?? []).length}
          onOpenComments={onOpenComments}
        />
      ))}

    </div>
  );
}
