// frontend/src/types/document.ts
//
// TypeScript types for the structured collaborative document.

export interface DocumentMeta {
  id: string;
  title: string;
  sourceType: 'transcript' | 'meeting' | 'notes' | 'custom';
  sourceId: string;
  createdBy: string;
  createdAt: string;
  aiModel: string;
  status: 'draft' | 'review' | 'final';
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
}

export interface Section {
  id: string;
  type: 'summary' | 'tasks' | 'decisions' | 'notes' | 'custom';
  title: string;
  collapsed: boolean;
  items: TaskItem[];
  // Rich-text content is stored as Y.XmlFragment, not serialized here
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
}

/** A comment with nested replies, assembled client-side. */
export interface CommentThread extends CommentData {
  replies: CommentThread[];
}
