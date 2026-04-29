// frontend/src/components/doc-editor/ReviewMode.tsx
//
// Continuous scrollable review mode (DocuSign + Git MR style).
// Shows all sections in a read-only rendered format with per-section
// review acknowledgement, progress tracking, and reviewer badges.

import { useState } from 'react';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Section, Participant, CommentThread, SectionReview } from '../../types/document';
import type { CollaborationProvider } from './TiptapEditor';
import TiptapEditor from './TiptapEditor';
import SectionComments from './SectionComments';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReviewModeProps {
  sections: Section[];
  participants: Participant[];
  userId: string;
  getSectionFragment: (sectionId: string) => XmlFragment | null;
  ydoc: Y.Doc;
  provider: CollaborationProvider | null;
  sectionReviews: Record<string, SectionReview[]>;
  reviewSection: (sectionId: string, status: SectionReview['status'], comment?: string) => void;
  comments?: Record<string, CommentThread[]>;
  onAddComment?: (sectionId: string, text: string, parentCommentId?: string | null) => void;
  onResolveThread?: (sectionId: string, commentId: string) => void;
  onUnresolveThread?: (sectionId: string, commentId: string) => void;
  onSectionFocus?: (sectionId: string) => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const typeBadgeColors: Record<Section['type'], { bg: string; text: string }> = {
  summary: { bg: '#dbeafe', text: '#1e40af' },
  tasks: { bg: '#fef3c7', text: '#92400e' },
  decisions: { bg: '#ede9fe', text: '#5b21b6' },
  notes: { bg: '#f3f4f6', text: '#374151' },
  custom: { bg: '#e0e7ff', text: '#3730a3' },
};

const statusConfig: Record<SectionReview['status'], { label: string; color: string; bg: string; icon: string }> = {
  approved: { label: 'Approved', color: '#166534', bg: '#dcfce7', icon: '\u2713' },
  reviewed: { label: 'Reviewed', color: '#374151', bg: '#f3f4f6', icon: '\u2014' },
  changes_requested: { label: 'Changes Requested', color: '#92400e', bg: '#fef3c7', icon: '!' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewMode({
  sections,
  participants,
  userId,
  getSectionFragment,
  ydoc,
  provider,
  sectionReviews,
  reviewSection,
  comments,
  onAddComment,
  onResolveThread,
  onUnresolveThread,
  onSectionFocus,
}: ReviewModeProps) {
  // Track which sections have the "change review" form open
  const [changingReview, setChangingReview] = useState<Record<string, boolean>>({});

  // Count how many sections the current user has reviewed
  const reviewedByMe = sections.filter((s) => {
    const reviews = sectionReviews[s.id] ?? [];
    return reviews.some((r) => r.userId === userId);
  }).length;

  // Collect all unique reviewers across the document
  const allReviewers = new Map<string, { displayName: string; statuses: SectionReview['status'][] }>();
  for (const s of sections) {
    for (const r of sectionReviews[s.id] ?? []) {
      const entry = allReviewers.get(r.userId) ?? { displayName: r.displayName, statuses: [] };
      entry.statuses.push(r.status);
      allReviewers.set(r.userId, entry);
    }
  }

  const pct = sections.length > 0 ? Math.round((reviewedByMe / sections.length) * 100) : 0;

  if (sections.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', fontSize: 15 }}>
        No sections to review.
      </div>
    );
  }

  return (
    <div data-testid="review-mode" style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Progress bar */}
      <div data-testid="review-progress" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span data-testid="review-progress-text">{reviewedByMe} of {sections.length} sections reviewed by you</span>
          <span data-testid="review-progress-pct">{pct}%</span>
        </div>
        <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: reviewedByMe === sections.length ? '#16a34a' : '#3b82f6',
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {sections.map((section) => {
          const fragment = getSectionFragment(section.id);
          const tc = typeBadgeColors[section.type] ?? typeBadgeColors.custom;
          const reviews = sectionReviews[section.id] ?? [];
          const myReview = reviews.find((r) => r.userId === userId);
          const otherReviews = reviews.filter((r) => r.userId !== userId);
          const sectionParticipants = participants.filter((p) => p.currentSectionId === section.id);
          const isChanging = changingReview[section.id] ?? false;

          return (
            <div
              key={section.id}
              id={`section-${section.id}`}
              data-testid={`review-section-${section.id}`}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '1.25rem',
                borderLeft: myReview
                  ? `3px solid ${statusConfig[myReview.status].color}`
                  : '3px solid #d1d5db',
              }}
              onMouseEnter={() => onSectionFocus?.(section.id)}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#1e293b', flex: 1 }}>
                  {section.title}
                </h3>
                <span style={{
                  display: 'inline-block',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 10px',
                  borderRadius: 9999,
                  background: tc.bg,
                  color: tc.text,
                }}>
                  {section.sectionType ?? section.type}
                </span>
              </div>

              {/* Rich-text content (read-only) */}
              {fragment && (
                <div style={{ marginBottom: section.items.length > 0 ? 16 : 8 }}>
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

              {/* No content */}
              {!fragment && section.items.length === 0 && (
                <div style={{ padding: '1rem 0', color: '#94a3b8', fontSize: 14, textAlign: 'center' }}>
                  This section has no content.
                </div>
              )}

              {/* Task items list */}
              {section.items.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {section.items.map((item) => {
                    const itemStatusColor =
                      item.status === 'acked' ? '#16a34a' :
                      item.status === 'rejected' ? '#dc2626' :
                      item.status === 'done' ? '#6b7280' : '#94a3b8';
                    return (
                      <div key={item.id} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '6px 0',
                        borderBottom: '1px solid #f3f4f6',
                        fontSize: 14,
                      }}>
                        <span style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: itemStatusColor,
                          marginTop: 5,
                          flexShrink: 0,
                        }} />
                        <div style={{ flex: 1 }}>
                          <span style={{ color: '#1e293b' }}>{item.text}</span>
                          {item.assignee && (
                            <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 8 }}>
                              — {item.assignee}
                            </span>
                          )}
                          {item.priority && item.priority !== 'medium' && (
                            <span style={{
                              fontSize: 10,
                              fontWeight: 600,
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: item.priority === 'high' ? '#fef2f2' : '#f0fdf4',
                              color: item.priority === 'high' ? '#dc2626' : '#16a34a',
                            }}>
                              {item.priority}
                            </span>
                          )}
                        </div>
                        <span style={{
                          fontSize: 11,
                          color: itemStatusColor,
                          fontWeight: 600,
                          textTransform: 'capitalize',
                          flexShrink: 0,
                        }}>
                          {item.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Review action bar */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 0 4px',
                borderTop: '1px solid #f3f4f6',
                flexWrap: 'wrap',
              }}>
                {(!myReview || isChanging) ? (
                  <>
                    <ReviewButton
                      testid={`section-${section.id}-review-reviewed`}
                      label="Mark Reviewed"
                      bg="#f3f4f6"
                      color="#374151"
                      hoverBg="#e5e7eb"
                      onClick={() => {
                        reviewSection(section.id, 'reviewed');
                        setChangingReview((prev) => ({ ...prev, [section.id]: false }));
                      }}
                    />
                    <ReviewButton
                      testid={`section-${section.id}-review-approved`}
                      label="Approve"
                      bg="#dcfce7"
                      color="#166534"
                      hoverBg="#bbf7d0"
                      onClick={() => {
                        reviewSection(section.id, 'approved');
                        setChangingReview((prev) => ({ ...prev, [section.id]: false }));
                      }}
                    />
                    <ReviewButton
                      testid={`section-${section.id}-review-changes-requested`}
                      label="Request Changes"
                      bg="#fef3c7"
                      color="#92400e"
                      hoverBg="#fde68a"
                      onClick={() => {
                        reviewSection(section.id, 'changes_requested');
                        setChangingReview((prev) => ({ ...prev, [section.id]: false }));
                      }}
                    />
                    {isChanging && (
                      <button
                        data-testid={`section-${section.id}-cancel-change`}
                        onClick={() => setChangingReview((prev) => ({ ...prev, [section.id]: false }))}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#6b7280',
                          fontSize: 12,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span
                      data-testid={`section-${section.id}-status`}
                      data-status={myReview.status}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: statusConfig[myReview.status].bg,
                        color: statusConfig[myReview.status].color,
                      }}>
                      <span style={{ fontSize: 14 }}>{statusConfig[myReview.status].icon}</span>
                      {statusConfig[myReview.status].label}
                    </span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      by you &middot; {new Date(myReview.timestamp).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <button
                      data-testid={`section-${section.id}-change-review`}
                      onClick={() => setChangingReview((prev) => ({ ...prev, [section.id]: true }))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#3b82f6',
                        fontSize: 12,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      Change
                    </button>
                  </>
                )}

                {/* Other reviewers as avatar badges */}
                {otherReviews.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
                    {otherReviews.map((r) => {
                      const cfg = statusConfig[r.status];
                      const initials = r.displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
                      return (
                        <div
                          key={r.userId}
                          title={`${r.displayName}: ${cfg.label}`}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: cfg.bg,
                            color: cfg.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            border: `2px solid ${cfg.color}`,
                          }}
                        >
                          {initials}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Viewing participants */}
                {sectionParticipants.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: otherReviews.length > 0 ? 0 : 'auto' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>Viewing:</span>
                    {sectionParticipants.map((p) => (
                      <div
                        key={p.clientId}
                        title={p.displayName}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: p.color,
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 9,
                          fontWeight: 600,
                        }}
                      >
                        {p.displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Comments */}
              {onAddComment && (
                <SectionComments
                  comments={comments?.[section.id] ?? []}
                  onAddComment={(text, parentCommentId) => onAddComment(section.id, text, parentCommentId)}
                  participants={participants}
                  onResolveThread={onResolveThread ? (commentId) => onResolveThread(section.id, commentId) : undefined}
                  onUnresolveThread={onUnresolveThread ? (commentId) => onUnresolveThread(section.id, commentId) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Document review summary */}
      {allReviewers.size > 0 && (
        <div
          data-testid="review-summary"
          style={{
            marginTop: 32,
            padding: '1rem 1.25rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
          }}
        >
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#475569' }}>
            Document Review Summary
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from(allReviewers.entries()).map(([uid, entry]) => {
              const approvedCount = entry.statuses.filter((s) => s === 'approved').length;
              const changesCount = entry.statuses.filter((s) => s === 'changes_requested').length;
              const reviewedCount = entry.statuses.filter((s) => s === 'reviewed').length;
              return (
                <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: '#1e293b', minWidth: 100 }}>
                    {entry.displayName}{uid === userId ? ' (you)' : ''}
                  </span>
                  <span style={{ color: '#6b7280' }}>
                    {entry.statuses.length} of {sections.length} sections
                  </span>
                  {approvedCount > 0 && (
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                      {approvedCount} approved
                    </span>
                  )}
                  {reviewedCount > 0 && (
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#f3f4f6', color: '#374151', fontWeight: 600 }}>
                      {reviewedCount} reviewed
                    </span>
                  )}
                  {changesCount > 0 && (
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                      {changesCount} changes requested
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review button sub-component
// ---------------------------------------------------------------------------

function ReviewButton({ label, bg, color, hoverBg, onClick, testid }: {
  label: string;
  bg: string;
  color: string;
  hoverBg: string;
  onClick: () => void;
  testid?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 600,
        border: '1px solid transparent',
        borderRadius: 6,
        background: hovered ? hoverBg : bg,
        color,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  );
}
