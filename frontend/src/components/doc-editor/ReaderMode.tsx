// frontend/src/components/doc-editor/ReaderMode.tsx
//
// Executive briefing dashboard -- synthesized summary view that makes a
// collaborative document useful at a glance.  Two-column layout with
// main content cards (executive summary, decisions, action items, section
// summaries) and a sidebar (progress, participants, document stats).

import { useState } from 'react';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, TaskItem, Participant, DocumentMeta, CommentThread } from '../../types/document';
import TiptapEditor from './TiptapEditor';
import type { CollaborationProvider } from './TiptapEditor';

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

const STATUS_COLORS = {
  pending: '#f59e0b',
  done: '#10b981',
  acked: '#10b981',
  rejected: '#ef4444',
} as const;

const PRIORITY_COLORS = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
} as const;

const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#fef3c7', text: '#92400e' },
  review: { bg: '#dbeafe', text: '#1e40af' },
  final: { bg: '#d1fae5', text: '#065f46' },
};

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

// --- layout ---

const gridLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 280px',
  gap: 16,
  maxWidth: 1100,
  margin: '0 auto',
};

// --- cards ---

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const sidebarCard: React.CSSProperties = {
  ...card,
  marginBottom: 12,
};

// --- typography ---

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

function statusIcon(status: TaskItem['status']): string {
  switch (status) {
    case 'acked':
    case 'done':
      return '\u2705';
    case 'rejected':
      return '\u274c';
    default:
      return '\u2b1c';
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

function generateSummaryBullets(
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
// Sub-components
// ---------------------------------------------------------------------------

function HeaderBanner({
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

function ExecutiveSummaryCard({
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

function KeyDecisionsCard({ sections }: { sections: Section[] }) {
  const decisionSections = sections.filter((s) => s.type === 'decisions');
  const items = decisionSections.flatMap((s) => s.items);

  return (
    <div style={card}>
      <h2 style={sectionHeader}>Key Decisions</h2>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
          No decisions recorded
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: '#334155',
              }}
            >
              <span style={{ flexShrink: 0 }}>{statusIcon(item.status)}</span>
              <span
                style={{
                  textDecoration:
                    item.status === 'acked' || item.status === 'done'
                      ? 'none'
                      : 'none',
                }}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CollapsibleGroup({
  label,
  count,
  color,
  defaultOpen,
  children,
}: {
  label: string;
  count: number;
  color: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 0',
          fontSize: 13,
          fontWeight: 600,
          color: '#334155',
          fontFamily: 'inherit',
          width: '100%',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            transition: 'transform 0.15s ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: 10,
          }}
        >
          {'\u25b6'}
        </span>
        <span style={{ color }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            background: `${color}18`,
            color,
            padding: '1px 8px',
            borderRadius: 9999,
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      </button>
      {open && <div style={{ paddingLeft: 16, marginTop: 4 }}>{children}</div>}
    </div>
  );
}

function ActionItemsCard({ allItems }: { allItems: TaskItem[] }) {
  const { pending, completed, rejected } = groupItems(allItems);

  return (
    <div style={card}>
      <h2 style={sectionHeader}>Action Items</h2>

      {allItems.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
          No action items yet
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <CollapsibleGroup
              label="Pending"
              count={pending.length}
              color={STATUS_COLORS.pending}
              defaultOpen={true}
            >
              {pending.map((item) => (
                <ItemRow key={item.id} item={item} variant="pending" />
              ))}
            </CollapsibleGroup>
          )}

          {completed.length > 0 && (
            <CollapsibleGroup
              label="Completed"
              count={completed.length}
              color={STATUS_COLORS.done}
              defaultOpen={false}
            >
              {completed.map((item) => (
                <ItemRow key={item.id} item={item} variant="completed" />
              ))}
            </CollapsibleGroup>
          )}

          {rejected.length > 0 && (
            <CollapsibleGroup
              label="Rejected"
              count={rejected.length}
              color={STATUS_COLORS.rejected}
              defaultOpen={false}
            >
              {rejected.map((item) => (
                <ItemRow key={item.id} item={item} variant="rejected" />
              ))}
            </CollapsibleGroup>
          )}
        </>
      )}
    </div>
  );
}

function ItemRow({
  item,
  variant,
}: {
  item: TaskItem;
  variant: 'pending' | 'completed' | 'rejected';
}) {
  const borderColor =
    variant === 'pending'
      ? STATUS_COLORS.pending
      : variant === 'completed'
        ? STATUS_COLORS.done
        : STATUS_COLORS.rejected;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        borderLeft: `3px solid ${borderColor}`,
        marginBottom: 4,
        borderRadius: '0 4px 4px 0',
        background: variant === 'pending' ? '#fffbeb' : '#fff',
      }}
    >
      <span style={{ fontSize: 13, flex: 1 }}>
        <span
          style={{
            textDecoration: variant === 'completed' ? 'line-through' : 'none',
            color: variant === 'completed' ? '#94a3b8' : '#334155',
          }}
        >
          {item.text}
        </span>
      </span>

      {item.priority && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 9999,
            background: `${PRIORITY_COLORS[item.priority]}18`,
            color: PRIORITY_COLORS[item.priority],
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          {item.priority}
        </span>
      )}

      {item.ackedBy && (
        <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>
          {item.ackedBy}
        </span>
      )}
    </div>
  );
}

function SectionSummariesCard({
  sections,
  commentCounts,
  sectionContentTexts,
  comments,
  getSectionFragment,
  ydoc,
  provider,
}: {
  sections: Section[];
  commentCounts?: Record<string, number>;
  sectionContentTexts?: Record<string, string>;
  comments?: Record<string, CommentThread[]>;
  getSectionFragment?: (sectionId: string) => XmlFragment | null;
  ydoc?: Y.Doc | null;
  provider?: CollaborationProvider | null;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const typeBadgeStyle = (type: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; text: string }> = {
      summary: { bg: '#e0e7ff', text: '#4338ca' },
      tasks: { bg: '#dbeafe', text: '#1e40af' },
      decisions: { bg: '#fce7f3', text: '#9d174d' },
      notes: { bg: '#f0fdf4', text: '#166534' },
      custom: { bg: '#f3f4f6', text: '#6b7280' },
    };
    const c = colors[type] ?? colors.custom;
    return {
      fontSize: 10,
      fontWeight: 600,
      padding: '1px 8px',
      borderRadius: 9999,
      background: c.bg,
      color: c.text,
      textTransform: 'capitalize' as const,
      flexShrink: 0,
    };
  };

  return (
    <div style={card}>
      <h2 style={sectionHeader}>Section Summaries</h2>
      {sections.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
          No sections
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sections.map((section) => {
            const done = section.items.filter(
              (i) => i.status === 'acked' || i.status === 'done',
            ).length;
            const total = section.items.length;
            const commentCount = commentCounts?.[section.id] ?? 0;
            const sectionContent = sectionContentTexts?.[section.id] ?? '';
            const sectionComments = comments?.[section.id] ?? [];
            const isOpen = !!expanded[section.id];
            const hasContent = sectionContent.trim().length > 0;

            return (
              <div key={section.id}>
                <button
                  onClick={() => toggle(section.id)}
                  style={{
                    background: isOpen ? '#f8fafc' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 6px',
                    borderRadius: 6,
                    width: '100%',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    color: '#334155',
                    transition: 'background 0.1s',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      transition: 'transform 0.15s ease',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      flexShrink: 0,
                    }}
                  >
                    {'\u25b6'}
                  </span>
                  <span style={{ fontWeight: 600, flex: 1, textAlign: 'left' }}>
                    {section.title}
                  </span>
                  <span style={typeBadgeStyle(section.type)}>{section.type}</span>
                  {total > 0 && (
                    <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>
                      {done}/{total} done
                    </span>
                  )}
                  {commentCount > 0 && (
                    <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>
                      {commentCount} comment{commentCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div style={{ paddingLeft: 24, paddingBottom: 8 }}>
                    {/* Rich-text content */}
                    {(() => {
                      const frag = getSectionFragment?.(section.id);
                      if (frag && ydoc) {
                        return (
                          <div style={{
                            padding: '4px 10px',
                            background: '#f8fafc',
                            borderRadius: 4,
                            borderLeft: '2px solid #cbd5e1',
                            marginBottom: section.items.length > 0 ? 8 : 0,
                          }}>
                            <TiptapEditor
                              fragment={frag}
                              ydoc={ydoc}
                              provider={provider ?? null}
                              user={{ name: '', color: '' }}
                              editable={false}
                            />
                          </div>
                        );
                      }
                      if (hasContent) {
                        return (
                          <div style={{
                            fontSize: 13,
                            color: '#334155',
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap',
                            padding: '8px 10px',
                            background: '#f8fafc',
                            borderRadius: 4,
                            borderLeft: '2px solid #cbd5e1',
                            marginBottom: section.items.length > 0 ? 8 : 0,
                          }}>
                            {sectionContent.trim()}
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Task items */}
                    {section.items.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 0',
                          fontSize: 12,
                          color: '#64748b',
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>{statusIcon(item.status)}</span>
                        <span
                          style={{
                            textDecoration:
                              item.status === 'acked' || item.status === 'done'
                                ? 'line-through'
                                : 'none',
                          }}
                        >
                          {item.text}
                        </span>
                      </div>
                    ))}

                    {/* Comments summary */}
                    {sectionComments.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                          Comments ({commentCount})
                        </div>
                        {sectionComments.slice(0, 3).map(c => (
                          <div key={c.id} style={{
                            fontSize: 12,
                            color: '#64748b',
                            padding: '2px 0',
                            display: 'flex',
                            gap: 6,
                          }}>
                            <span style={{ fontWeight: 600, color: '#475569', flexShrink: 0 }}>
                              {c.displayName}:
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.text}
                            </span>
                          </div>
                        ))}
                        {sectionComments.length > 3 && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                            +{sectionComments.length - 3} more
                          </div>
                        )}
                      </div>
                    )}

                    {/* Empty state */}
                    {!hasContent && section.items.length === 0 && sectionComments.length === 0 && (
                      <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                        No content in this section
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Sidebar cards ---

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
  allItems: TaskItem[];
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
