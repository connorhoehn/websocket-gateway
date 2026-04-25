// frontend/src/components/observability/components/EventTimeline.tsx
//
// Center column of /observability/events. Scrollable list of event rows; when
// `live=true` autoscrolls to the bottom unless the user has scrolled up, in
// which case a "Jump to live ↓" pill appears.
//
// Phase 1 uses a plain mapped list. Phase 2+ swaps in react-window for
// virtualization per PIPELINES_PLAN.md §18.8.

import { useEffect, useRef, useState } from 'react';
import EventRow from '../../shared/EventRow';
import EmptyState from '../../shared/EmptyState';
import { colors } from '../../../constants/styles';

export interface EventItem {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  payload?: unknown;
}

export interface EventTimelineProps {
  events: EventItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  live?: boolean;
}

function EventTimeline({ events, selectedId, onSelect, live = false }: EventTimelineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [detached, setDetached] = useState(false);

  // Autoscroll to bottom when live and user hasn't scrolled up.
  useEffect(() => {
    if (!live) return;
    if (detached) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, live, detached]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setDetached(!atBottom);
  };

  const jumpToLive = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setDetached(false);
  };

  if (events.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex' }}>
        <EmptyState
          icon="📡"
          title="No events yet"
          body="Trigger a pipeline to see activity here."
        />
      </div>
    );
  }

  return (
    <div
      data-testid="event-timeline"
      style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: 'auto', padding: '6px 0',
          fontFamily: 'inherit',
        }}
      >
        {events.map((ev) => (
          <EventRow
            key={ev.id}
            timestamp={ev.timestamp}
            type={ev.type}
            summary={ev.summary}
            severity={ev.severity}
            selected={ev.id === selectedId}
            onClick={onSelect ? () => onSelect(ev.id) : undefined}
          />
        ))}
      </div>

      {live && detached && (
        <button
          data-testid="jump-to-live"
          onClick={jumpToLive}
          style={{
            position: 'absolute', bottom: 12, left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            background: colors.primary, color: '#fff',
            border: 'none', borderRadius: 999, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontFamily: 'inherit',
          }}
        >
          Jump to live ↓
        </button>
      )}
    </div>
  );
}

export default EventTimeline;
