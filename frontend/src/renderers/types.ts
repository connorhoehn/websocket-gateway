// frontend/src/renderers/types.ts
//
// Shared props interface for all section renderers.
// Every renderer receives this contract; it picks what it needs.

import type { XmlFragment } from 'yjs';
import type * as Y from 'yjs';
import type { Section, TaskItem, Participant, CommentThread, ViewMode } from '../types/document';
import type { CollaborationProvider } from '../components/doc-editor/TiptapEditor';

export interface SectionRendererProps {
  section: Section;
  viewMode: ViewMode;
  editable: boolean;

  // Y.js rich-text binding
  fragment?: XmlFragment | null;
  ydoc?: Y.Doc | null;
  provider?: CollaborationProvider | null;
  user?: { name: string; color: string };

  // Mutation callbacks (undefined in read-only contexts)
  onUpdateSection?: (patch: Partial<Section>) => void;
  onAddItem?: (item: Omit<TaskItem, 'id'>) => void;
  onUpdateItem?: (itemId: string, patch: Partial<TaskItem>) => void;
  onRemoveItem?: (itemId: string) => void;

  // Collaboration
  participants?: Participant[];
  onUpdateCursorInfo?: (name: string, color: string) => void;

  // Comments
  comments?: CommentThread[];
  commentCount?: number;
  onOpenComments?: (sectionId: string) => void;

  // Navigation: reader → editor mode at this section
  onNavigateToEditor?: (sectionId: string) => void;
}

export type SectionRenderer = React.ComponentType<SectionRendererProps>;
