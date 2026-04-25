// frontend/src/components/observability/components/EventDetailPane.tsx
//
// Right-side detail pane for /observability/events. Pretty-prints the selected
// event payload as JSON and exposes copy / download buttons. Null state is a
// gentle prompt to pick a row.

import { colors } from '../../../constants/styles';
import type { EventItem } from './EventTimeline';

export interface EventDetailPaneProps {
  event: EventItem | null;
}

function prettyJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function EventDetailPane({ event }: EventDetailPaneProps) {
  if (!event) {
    return (
      <div
        data-testid="event-detail-empty"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', fontSize: 13, color: colors.textTertiary,
          padding: 24, textAlign: 'center', fontFamily: 'inherit',
        }}
      >
        Select an event to see details
      </div>
    );
  }

  const body = prettyJSON(event.payload ?? event);

  const onCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(body).catch(() => {
        // eslint-disable-next-line no-console
        console.warn('[EventDetailPane] clipboard copy failed');
      });
    }
  };

  const onDownload = () => {
    if (typeof window === 'undefined') return;
    const blob = new Blob([body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.type}-${event.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="event-detail-pane"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        fontFamily: 'inherit', background: colors.surface,
      }}
    >
      <div
        style={{
          padding: '12px 14px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
          {event.type}
        </div>
        <div style={{ fontSize: 11, color: colors.textTertiary }}>{event.timestamp}</div>
      </div>

      <div
        style={{
          padding: '10px 14px', display: 'flex', gap: 8,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <button
          data-testid="event-detail-copy"
          onClick={onCopy}
          style={{
            padding: '5px 10px', fontSize: 12, fontWeight: 600,
            background: colors.surfaceHover, color: colors.textSecondary,
            border: `1px solid ${colors.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Copy
        </button>
        <button
          data-testid="event-detail-download"
          onClick={onDownload}
          style={{
            padding: '5px 10px', fontSize: 12, fontWeight: 600,
            background: colors.surfaceHover, color: colors.textSecondary,
            border: `1px solid ${colors.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Download
        </button>
      </div>

      <pre
        style={{
          margin: 0, padding: '12px 14px', flex: 1, overflow: 'auto',
          background: colors.surfaceInset,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12, color: colors.textPrimary, lineHeight: 1.5,
          whiteSpace: 'pre', tabSize: 2,
        }}
      >
        {body}
      </pre>
    </div>
  );
}

export default EventDetailPane;
