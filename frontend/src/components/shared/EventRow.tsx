// frontend/src/components/shared/EventRow.tsx
//
// Stub. Dense row used by /observability/events and BigBrotherPanel.
// Real implementation will wire in icon/color via getEventGlyph().

import { getEventGlyph } from './eventGlyphs';

export interface EventRowProps {
  timestamp: string;
  type: string;
  summary: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  onClick?: () => void;
  selected?: boolean;
}

const severityColor: Record<NonNullable<EventRowProps['severity']>, string> = {
  info: '#64748b',
  warning: '#d97706',
  error: '#dc2626',
  success: '#16a34a',
};

function EventRow({ timestamp, type, summary, severity = 'info', onClick, selected }: EventRowProps) {
  const glyph = getEventGlyph(type);

  return (
    <div
      data-testid="event-row"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', fontSize: 13, fontFamily: 'inherit',
        background: selected ? '#ede9fe' : 'transparent',
        borderRadius: 6, cursor: onClick ? 'pointer' : 'default',
        color: '#0f172a',
      }}
    >
      <span style={{ fontSize: 14, color: glyph.color, flexShrink: 0 }}>{glyph.icon}</span>
      <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0, width: 70 }}>{timestamp}</span>
      <span style={{ fontSize: 12, color: severityColor[severity], fontWeight: 600, flexShrink: 0 }}>
        {type}
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {summary}
      </span>
    </div>
  );
}

export default EventRow;
