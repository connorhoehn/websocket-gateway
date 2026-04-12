// frontend/src/components/doc-editor/ReaderSectionCard.tsx
//
// Renders section summaries in ReaderMode: expandable sections with
// rich-text content, task items, and comments preview.

import { useState } from 'react';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, TaskItem, CommentThread } from '../../types/document';
import TiptapEditor from './TiptapEditor';
import type { CollaborationProvider } from './TiptapEditor';

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CollapsibleGroup (used by ActionItemsCard)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ItemRow
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// KeyDecisionsCard
// ---------------------------------------------------------------------------

export function KeyDecisionsCard({ sections }: { sections: Section[] }) {
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

// ---------------------------------------------------------------------------
// ActionItemsCard
// ---------------------------------------------------------------------------

export function ActionItemsCard({ allItems }: { allItems: TaskItem[] }) {
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

// ---------------------------------------------------------------------------
// SectionSummariesCard
// ---------------------------------------------------------------------------

export function SectionSummariesCard({
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
