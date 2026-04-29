// frontend/src/components/shared/eventGlyphs.ts
//
// Canonical lookup table mapping event-type strings to an icon, color, and
// severity classification. Consumed by BigBrotherPanel, ActivityFeed, the
// pipeline ExecutionLog, and the Observability EventsPage so every surface
// shows events with consistent visual treatment.
//
// Visual continuity: icons for doc.* / social.* entries are preserved from
// the original inline maps in BigBrotherPanel.tsx and doc-editor/ActivityFeed.tsx.

import { colors } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventGlyph {
  icon: string;
  color: string;
  severity: 'info' | 'success' | 'warning' | 'error' | 'neutral';
}

// Semantic colour shortcuts (map spec colours to colors.state.* where possible).
const C_SUCCESS = colors.state.completed; // #16a34a
const C_ERROR   = colors.state.failed;    // #dc2626
const C_WARNING = '#d97706';              // warning amber (spec)
const C_INFO    = colors.state.running;   // #2563eb
const C_NEUTRAL = colors.textTertiary;    // #94a3b8
const C_SOCIAL  = colors.primary;         // #646cff
const C_DOC     = colors.textPrimary;     // #0f172a

// ---------------------------------------------------------------------------
// Glyph map
// ---------------------------------------------------------------------------

export const eventGlyphs: Record<string, EventGlyph> = {
  // Pipeline run lifecycle
  'pipeline.run.started':        { icon: '▶', color: C_INFO,    severity: 'info' },
  'pipeline.run.completed':      { icon: '✓', color: C_SUCCESS, severity: 'success' },
  'pipeline.run.failed':         { icon: '✕', color: C_ERROR,   severity: 'error' },
  'pipeline.run.cancelled':      { icon: '⊘', color: C_NEUTRAL, severity: 'neutral' },
  'pipeline.run.orphaned':       { icon: '⚠', color: C_WARNING, severity: 'warning' },
  'pipeline.run.reassigned':     { icon: '↔', color: C_INFO,    severity: 'info' },
  'pipeline.run.paused':         { icon: '⏸', color: C_WARNING, severity: 'warning' },
  'pipeline.run.resumed':        { icon: '▶', color: C_INFO,    severity: 'info' },
  'pipeline.run.resumeFromStep': { icon: '↻', color: C_INFO,    severity: 'info' },
  'pipeline.run.retry':          { icon: '↻', color: C_INFO,    severity: 'info' },

  // Pipeline step lifecycle
  'pipeline.step.started':       { icon: '▸', color: C_INFO,    severity: 'info' },
  'pipeline.step.completed':     { icon: '✓', color: C_SUCCESS, severity: 'success' },
  'pipeline.step.failed':        { icon: '✕', color: C_ERROR,   severity: 'error' },
  'pipeline.step.skipped':       { icon: '–', color: C_NEUTRAL, severity: 'neutral' },
  'pipeline.step.cancelled':     { icon: '⊘', color: C_NEUTRAL, severity: 'neutral' },

  // Pipeline LLM streaming
  'pipeline.llm.prompt':         { icon: '💬', color: C_INFO,    severity: 'info' },
  'pipeline.llm.stream.opened':  { icon: '⟳', color: C_INFO,    severity: 'info' },
  'pipeline.llm.token':          { icon: '·',       color: C_NEUTRAL, severity: 'neutral' },
  'pipeline.llm.response':       { icon: '💬', color: C_INFO,    severity: 'info' },

  // Pipeline human approval
  'pipeline.approval.requested': { icon: '✋', color: C_WARNING, severity: 'warning' },
  'pipeline.approval.recorded':  { icon: '✓', color: C_SUCCESS, severity: 'success' },

  // Pipeline join coordination
  'pipeline.join.waiting':       { icon: '⏳', color: C_WARNING, severity: 'warning' },
  'pipeline.join.fired':         { icon: '⑃', color: C_INFO,    severity: 'info' },

  // Document editor — item / section mutations
  'doc.add_item':                { icon: '➕',       color: C_DOC, severity: 'info' },
  'doc.remove_item':             { icon: '➖',       color: C_DOC, severity: 'neutral' },
  'doc.add_section':             { icon: '📁', color: C_DOC, severity: 'info' },
  'doc.edit_section':            { icon: '✏',       color: C_DOC, severity: 'info' },

  // Document editor — comments / threads / mentions
  'doc.comment':                 { icon: '💬', color: C_DOC,     severity: 'info' },
  'doc.mention':                 { icon: '@',            color: C_DOC,     severity: 'info' },
  'doc.resolve_thread':          { icon: '✓',       color: C_SUCCESS, severity: 'success' },
  'doc.unresolve_thread':        { icon: '✕',       color: C_ERROR,   severity: 'error' },

  // Document editor — review / ack / reject / lifecycle
  'doc.finalize':                { icon: '🔒', color: C_DOC,     severity: 'info' },
  'doc.unlock':                  { icon: '🔓', color: C_DOC,     severity: 'info' },
  'doc.review_approved':         { icon: '✓',       color: C_SUCCESS, severity: 'success' },
  'doc.review_reviewed':         { icon: '👀', color: C_INFO,    severity: 'info' },
  'doc.review_changes_requested':{ icon: '✕',       color: C_ERROR,   severity: 'error' },
  'doc.ack':                     { icon: '✅',       color: C_SUCCESS, severity: 'success' },
  'doc.reject':                  { icon: '❌',       color: C_ERROR,   severity: 'error' },

  // Social — rooms / follow / reactions / posts
  'social.room.join':            { icon: '🚪', color: C_SOCIAL,  severity: 'info' },
  'social.room.leave':           { icon: '🚪', color: C_NEUTRAL, severity: 'neutral' },
  'social.follow':               { icon: '👥', color: C_SUCCESS, severity: 'success' },
  'social.unfollow':             { icon: '👥', color: C_NEUTRAL, severity: 'neutral' },
  'social.like':                 { icon: '❤',       color: C_SUCCESS, severity: 'success' },
  'social.reaction':             { icon: '😀', color: C_SOCIAL,  severity: 'info' },
  'social.post.created':         { icon: '📝', color: C_SOCIAL,  severity: 'info' },
  'social.comment.created':      { icon: '💬', color: C_SOCIAL,  severity: 'info' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a glyph for an event type, falling back to a neutral bullet.
 */
export function getEventGlyph(type: string): EventGlyph {
  return eventGlyphs[type] ?? { icon: '•', color: colors.textTertiary, severity: 'neutral' };
}

/**
 * Maps an event type prefix to a category for filter UIs.
 * Used by ExecutionLog + Observability EventsPage to group filters.
 */
export function getEventCategory(
  type: string,
): 'lifecycle' | 'step' | 'llm' | 'approval' | 'activity' | 'social' | 'other' {
  if (type.startsWith('pipeline.run.') || type.startsWith('pipeline.join.')) return 'lifecycle';
  if (type.startsWith('pipeline.step.')) return 'step';
  if (type.startsWith('pipeline.llm.')) return 'llm';
  if (type.startsWith('pipeline.approval.')) return 'approval';
  if (type.startsWith('doc.')) return 'activity';
  if (type.startsWith('social.')) return 'social';
  return 'other';
}
