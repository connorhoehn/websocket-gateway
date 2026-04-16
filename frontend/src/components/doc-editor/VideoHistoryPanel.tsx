// frontend/src/components/doc-editor/VideoHistoryPanel.tsx
//
// Shows past video call sessions for a document — participants, duration,
// and future transcript/summary once the VNL pipeline populates them.

import { useEffect } from 'react';
import { colors, fontSize, spacing, borderRadius } from '../../styles/tokens';
import { Panel, PanelHeader, PanelBody } from '../ui/Panel';
import type { VideoSession } from '../../hooks/useVideoSessions';

interface VideoHistoryPanelProps {
  sessions: VideoSession[];
  loading: boolean;
  onFetch: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VideoHistoryPanel({ sessions, loading, onFetch, onClose }: VideoHistoryPanelProps) {
  useEffect(() => { onFetch(); }, [onFetch]);

  const endedSessions = sessions.filter(s => s.status === 'ended');
  const activeSessions = sessions.filter(s => s.status === 'active');

  return (
    <Panel width={340}>
      <PanelHeader title="Past Conversations" onClose={onClose} />
      <PanelBody padding={`${spacing.md}px`}>
        {loading && (
          <div style={{ textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.lg }}>
            Loading...
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm, padding: spacing.lg }}>
            No video conversations yet for this document.
          </div>
        )}

        {/* Active calls */}
        {activeSessions.map(session => (
          <SessionCard key={session.sessionId} session={session} isActive />
        ))}

        {/* Past calls */}
        {endedSessions.map(session => (
          <SessionCard key={session.sessionId} session={session} />
        ))}
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// SessionCard
// ---------------------------------------------------------------------------

function SessionCard({ session, isActive }: { session: VideoSession; isActive?: boolean }) {
  return (
    <div style={{
      border: `1px solid ${isActive ? colors.success : colors.border}`,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      background: isActive ? 'rgba(16,185,129,0.04)' : colors.surface,
    }}>
      {/* Top row: time + duration */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
        <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
          {relativeTime(session.startedAt)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
          {isActive && (
            <span style={{
              fontSize: fontSize.xs, fontWeight: 600, color: colors.success,
              background: 'rgba(16,185,129,0.1)', padding: '1px 6px',
              borderRadius: borderRadius.full,
            }}>
              Live
            </span>
          )}
          <span style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>
            {formatDuration(session.startedAt, session.endedAt)}
          </span>
        </div>
      </div>

      {/* Participants */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {session.participants.map((p, i) => (
          <span key={`${p.userId}-${i}`} style={{
            fontSize: fontSize.xs, color: colors.textSecondary,
            background: colors.background, padding: '2px 8px',
            borderRadius: borderRadius.full,
          }}>
            {p.displayName || p.userId.slice(0, 10)}
          </span>
        ))}
      </div>

      {/* Summary (if available) */}
      {session.aiSummary && (
        <div style={{
          fontSize: fontSize.xs, color: colors.textPrimary,
          background: colors.background, padding: spacing.sm,
          borderRadius: borderRadius.md, lineHeight: 1.5,
        }}>
          {session.aiSummary}
        </div>
      )}

      {/* Transcript status */}
      {session.transcriptStatus && session.transcriptStatus !== 'available' && (
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs }}>
          Transcript: {session.transcriptStatus}
        </div>
      )}
    </div>
  );
}
