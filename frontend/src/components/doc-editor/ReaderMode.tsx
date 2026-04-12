// frontend/src/components/doc-editor/ReaderMode.tsx
//
// Executive briefing dashboard -- synthesized summary view that makes a
// collaborative document useful at a glance.  Two-column layout with
// main content cards (executive summary, decisions, action items, section
// summaries) and a sidebar (progress, participants, document stats).
//
// Layout container that composes sub-components:
//   - ReaderSummary (HeaderBanner, ExecutiveSummaryCard)
//   - ReaderSectionCard (KeyDecisionsCard, ActionItemsCard, SectionSummariesCard)

import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, Participant, DocumentMeta, CommentThread } from '../../types/document';
import type { CollaborationProvider } from './TiptapEditor';
import { HeaderBanner, ExecutiveSummaryCard, generateSummaryBullets } from './ReaderSummary';
import { KeyDecisionsCard, ActionItemsCard, SectionSummariesCard } from './ReaderSectionCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReaderModeProps {
  sections: Section[];
  participants: Participant[];
  meta: DocumentMeta;
  commentCounts?: Record<string, number>; // sectionId -> count
  /** Plain-text content extracted from each section's Y.XmlFragment */
  sectionContentTexts?: Record<string, string>;
  /** Threaded comments per section */
  comments?: Record<string, CommentThread[]>;
  /** Y.js fragment getter for rich-text rendering */
  getSectionFragment?: (sectionId: string) => XmlFragment | null;
  /** Y.Doc instance for collaboration */
  ydoc?: Y.Doc | null;
  /** Collaboration provider for awareness */
  provider?: CollaborationProvider | null;
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const gridLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 280px',
  gap: 16,
  maxWidth: 1100,
  margin: '0 auto',
};

const sidebarCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
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

function progressColor(pct: number): string {
  if (pct >= 75) return '#10b981';
  if (pct >= 25) return '#f59e0b';
  return '#ef4444';
}

const MODE_DOT_COLORS: Record<string, string> = {
  editor: '#10b981',
  reviewer: '#f59e0b',
  reader: '#94a3b8',
};

const MODE_LABELS: Record<string, string> = {
  editor: 'editing',
  reviewer: 'reviewing',
  reader: 'reading',
};

// ---------------------------------------------------------------------------
// Sidebar sub-components
// ---------------------------------------------------------------------------

function ProgressCard({
  reviewed,
  total,
}: {
  reviewed: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const color = progressColor(pct);

  return (
    <div style={sidebarCard}>
      <h3 style={sectionHeader}>Progress</h3>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>
          {pct}%
        </span>
      </div>
      <div
        style={{
          height: 8,
          background: '#e5e7eb',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        {reviewed} of {total} items reviewed
      </div>
    </div>
  );
}

function WhosHereCard({ participants }: { participants: Participant[] }) {
  return (
    <div style={sidebarCard}>
      <h3 style={sectionHeader}>Who's Here</h3>
      {participants.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
          No participants online
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {participants.map((p) => (
            <div
              key={p.clientId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: MODE_DOT_COLORS[p.mode] ?? '#94a3b8',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 500, color: '#334155', flex: 1 }}>
                {p.displayName}
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {MODE_LABELS[p.mode] ?? p.mode}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentStatsCard({
  sections,
  allItems,
  completedCount,
  commentCounts,
  meta,
}: {
  sections: Section[];
  allItems: import('../../types/document').TaskItem[];
  completedCount: number;
  commentCounts?: Record<string, number>;
  meta: DocumentMeta;
}) {
  const totalComments = commentCounts
    ? Object.values(commentCounts).reduce((a, b) => a + b, 0)
    : 0;

  const statRow: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: 13,
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
  };

  return (
    <div style={sidebarCard}>
      <h3 style={sectionHeader}>Document Info</h3>
      <div style={statRow}>
        <span style={{ color: '#64748b' }}>Sections</span>
        <span style={{ fontWeight: 600 }}>{sections.length}</span>
      </div>
      <div style={statRow}>
        <span style={{ color: '#64748b' }}>Total tasks</span>
        <span style={{ fontWeight: 600 }}>{allItems.length}</span>
      </div>
      <div style={statRow}>
        <span style={{ color: '#64748b' }}>Completed</span>
        <span style={{ fontWeight: 600, color: '#10b981' }}>{completedCount}</span>
      </div>
      {totalComments > 0 && (
        <div style={statRow}>
          <span style={{ color: '#64748b' }}>Comments</span>
          <span style={{ fontWeight: 600 }}>{totalComments}</span>
        </div>
      )}
      {meta.createdAt && (
        <div style={{ ...statRow, borderBottom: 'none' }}>
          <span style={{ color: '#64748b' }}>Created</span>
          <span style={{ fontWeight: 500, fontSize: 12 }}>{formatDate(meta.createdAt)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReaderMode({
  sections,
  participants,
  meta,
  commentCounts,
  sectionContentTexts,
  comments,
  getSectionFragment,
  ydoc,
  provider,
}: ReaderModeProps) {
  const allItems = sections.flatMap((s) => s.items);
  const reviewed = allItems.filter((i) => i.status !== 'pending').length;
  const completedCount = allItems.filter(
    (i) => i.status === 'acked' || i.status === 'done',
  ).length;

  const summaryBullets = generateSummaryBullets(allItems, sections);

  return (
    <div style={gridLayout}>
      {/* Header spanning both columns */}
      <HeaderBanner meta={meta} participantCount={participants.length} />

      {/* Main content column */}
      <div>
        <ExecutiveSummaryCard
          bullets={summaryBullets}
          contentText={(() => {
            const summarySection = sections.find(s => s.type === 'summary');
            return summarySection ? sectionContentTexts?.[summarySection.id] : undefined;
          })()}
          fragment={(() => {
            const summarySection = sections.find(s => s.type === 'summary');
            return summarySection ? getSectionFragment?.(summarySection.id) : null;
          })()}
          ydoc={ydoc}
          provider={provider}
        />
        <KeyDecisionsCard sections={sections} />
        <ActionItemsCard allItems={allItems} />
        <SectionSummariesCard
          sections={sections}
          commentCounts={commentCounts}
          sectionContentTexts={sectionContentTexts}
          comments={comments}
          getSectionFragment={getSectionFragment}
          ydoc={ydoc}
          provider={provider}
        />
      </div>

      {/* Sidebar column */}
      <div>
        <ProgressCard reviewed={reviewed} total={allItems.length} />
        <WhosHereCard participants={participants} />
        <DocumentStatsCard
          sections={sections}
          allItems={allItems}
          completedCount={completedCount}
          commentCounts={commentCounts}
          meta={meta}
        />
      </div>
    </div>
  );
}
