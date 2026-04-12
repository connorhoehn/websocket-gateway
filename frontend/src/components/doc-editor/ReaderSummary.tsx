// frontend/src/components/doc-editor/ReaderSummary.tsx
//
// Header banner and executive summary card for ReaderMode.

import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { DocumentMeta, Section, TaskItem } from '../../types/document';
import TiptapEditor from './TiptapEditor';
import type { CollaborationProvider } from './TiptapEditor';

// ---------------------------------------------------------------------------
// Style constants (shared with ReaderMode)
// ---------------------------------------------------------------------------

const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#fef3c7', text: '#92400e' },
  review: { bg: '#dbeafe', text: '#1e40af' },
  final: { bg: '#d1fae5', text: '#065f46' },
};

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const sectionHeader: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#64748b',
  margin: 0,
  marginBottom: 12,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function groupItems(items: TaskItem[]) {
  const pending: TaskItem[] = [];
  const completed: TaskItem[] = [];
  const rejected: TaskItem[] = [];
  for (const item of items) {
    if (item.status === 'rejected') rejected.push(item);
    else if (item.status === 'acked' || item.status === 'done') completed.push(item);
    else pending.push(item);
  }
  return { pending, completed, rejected };
}

export function generateSummaryBullets(
  allItems: TaskItem[],
  sections: Section[],
): string[] {
  const { pending, completed, rejected } = groupItems(allItems);
  const total = allItems.length;
  const bullets: string[] = [];

  if (total > 0) {
    const pct = Math.round((completed.length / total) * 100);
    bullets.push(
      `${total} action item${total !== 1 ? 's' : ''} identified, ${completed.length} completed (${pct}%).`,
    );
  } else {
    bullets.push('No action items recorded yet.');
  }

  const decisionSections = sections.filter((s) => s.type === 'decisions');
  const decisionItems = decisionSections.flatMap((s) => s.items);
  if (decisionItems.length > 0) {
    const decidedCount = decisionItems.filter(
      (i) => i.status === 'acked' || i.status === 'done',
    ).length;
    bullets.push(
      `${decisionItems.length} key decision${decisionItems.length !== 1 ? 's' : ''} recorded${decidedCount > 0 ? `, ${decidedCount} finalized` : ''}.`,
    );
  }

  if (pending.length > 0) {
    bullets.push(
      `${pending.length} item${pending.length !== 1 ? 's' : ''} still pending review.`,
    );
  }

  if (rejected.length > 0) {
    bullets.push(
      `${rejected.length} item${rejected.length !== 1 ? 's' : ''} rejected and need${rejected.length === 1 ? 's' : ''} revision.`,
    );
  }

  return bullets;
}

// ---------------------------------------------------------------------------
// HeaderBanner
// ---------------------------------------------------------------------------

export function HeaderBanner({
  meta,
  participantCount,
}: {
  meta: DocumentMeta;
  participantCount: number;
}) {
  const sc = STATUS_BADGE_COLORS[meta.status] ?? STATUS_BADGE_COLORS.draft;
  return (
    <div
      style={{
        borderTop: '3px solid #3b82f6',
        background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
        borderRadius: '8px 8px 0 0',
        padding: '20px 24px 16px',
        marginBottom: 16,
        gridColumn: '1 / -1',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: 0,
            color: '#0f172a',
            flex: 1,
          }}
        >
          {meta.title || 'Untitled Document'}
        </h1>
        <span
          style={{
            display: 'inline-block',
            fontSize: 12,
            fontWeight: 600,
            padding: '3px 12px',
            borderRadius: 9999,
            background: sc.bg,
            color: sc.text,
            textTransform: 'capitalize',
          }}
        >
          {meta.status}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        {meta.createdBy && <>Created by {meta.createdBy}</>}
        {meta.createdAt && <> &middot; {formatDate(meta.createdAt)}</>}
        {participantCount > 0 && (
          <> &middot; {participantCount} participant{participantCount !== 1 ? 's' : ''}</>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExecutiveSummaryCard
// ---------------------------------------------------------------------------

export function ExecutiveSummaryCard({
  bullets,
  contentText,
  fragment,
  ydoc,
  provider,
}: {
  bullets: string[];
  contentText?: string;
  fragment?: XmlFragment | null;
  ydoc?: Y.Doc | null;
  provider?: CollaborationProvider | null;
}) {
  const hasFragment = fragment && ydoc;
  const hasContent = contentText && contentText.trim().length > 0;
  return (
    <div style={card}>
      <h2 style={sectionHeader}>Executive Summary</h2>
      {hasFragment ? (
        <div style={{
          marginBottom: bullets.length > 0 ? 12 : 0,
          padding: '4px 12px',
          background: '#f8fafc',
          borderRadius: 6,
          borderLeft: '3px solid #8b5cf6',
        }}>
          <TiptapEditor
            fragment={fragment}
            ydoc={ydoc}
            provider={provider ?? null}
            user={{ name: '', color: '' }}
            editable={false}
          />
        </div>
      ) : hasContent ? (
        <div style={{
          fontSize: 14,
          color: '#1e293b',
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          marginBottom: bullets.length > 0 ? 12 : 0,
          padding: '8px 12px',
          background: '#f8fafc',
          borderRadius: 6,
          borderLeft: '3px solid #8b5cf6',
        }}>
          {contentText!.trim()}
        </div>
      ) : null}
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}
