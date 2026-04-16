// frontend/src/types/document.ts
//
// TypeScript types for the structured collaborative document.

export interface DocumentMeta {
  id: string;
  title: string;
  sourceType: 'transcript' | 'meeting' | 'notes' | 'custom';
  sourceId: string;
  createdBy: string;
  createdByName?: string;   // human-readable name of document creator
  createdAt: string;
  aiModel: string;
  status: 'draft' | 'review' | 'final';
  documentType?: string;   // template type identifier (e.g. 'meeting', 'retro', 'sprint')
  updatedAt?: string;      // ISO timestamp of last modification
  activeCallSessionId?: string;  // VNL session ID when a video call is active
}

export interface TaskItem {
  id: string;
  text: string;
  status: 'pending' | 'acked' | 'done' | 'rejected';
  assignee: string;
  ackedBy: string;
  ackedAt: string;
  priority: 'low' | 'medium' | 'high';
  notes: string;
  dueDate?: string;    // ISO date string
  category?: string;   // categorization (e.g. 'start' | 'stop' | 'continue' in retros)
}

/** Specialized section renderer type — extends beyond the base `type` for richer UIs. */
export type SectionType =
  | 'tasks'
  | 'rich-text'
  | 'decisions'
  | 'timeline'
  | 'checklist'
  | 'rating'
  | 'voting';

export interface Section {
  id: string;
  type: 'summary' | 'tasks' | 'decisions' | 'notes' | 'custom';
  title: string;
  collapsed: boolean;
  items: TaskItem[];
  // Rich-text content is stored as Y.XmlFragment, not serialized here
  sectionType?: SectionType;                  // renderer hint (falls back to type-based rendering)
  metadata?: Record<string, unknown>;         // section-level metadata (dates, severity, etc.)
  placeholder?: string;                       // guidance text shown when section is empty
}

export interface DocumentData {
  meta: DocumentMeta;
  sections: Section[];
}

export interface Participant {
  clientId: string;
  userId: string;
  displayName: string;
  color: string;
  mode: 'editor' | 'reviewer' | 'reader';
  currentSectionId: string | null;
  lastSeen?: number; // Unix ms timestamp of last activity
  idle?: boolean;    // true when user has been inactive for 2+ minutes
}

export type ViewMode = 'editor' | 'ack' | 'reader';

/** A flat comment as stored in Y.js. */
export interface CommentData {
  id: string;
  text: string;
  userId: string;
  displayName: string;
  color: string;
  timestamp: string;
  parentCommentId: string | null;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

/** A comment with nested replies, assembled client-side. */
export interface CommentThread extends CommentData {
  replies: CommentThread[];
}

/** Per-section review status (DocuSign-style acknowledgement). */
export interface SectionReview {
  userId: string;
  displayName: string;
  status: 'reviewed' | 'approved' | 'changes_requested';
  timestamp: string;
  comment?: string;
}
