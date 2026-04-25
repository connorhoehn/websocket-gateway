// frontend/src/components/pipelines/replay/Scrubber.tsx
//
// Phase-1 scrubber strip for PipelineRunReplayPage. Renders the play / pause
// / stop transport, speed pills (0.5× / 1× / 2× / 4× / instant), an event
// timeline with one tick per envelope (color-keyed by `getEventGlyph`), and
// a cursor / total readout. Click a tick → `seek(idx)`. Hover a tick → tip
// shows the event type. Phase 5 will swap the underlying replay source from
// the persisted-run derivation in `deriveEvents.ts` to a true WAL stream from
// distributed-core's EventBus, but the strip stays the same.

import type { CSSProperties } from 'react';

import type { ReplayDriver, ReplaySpeed } from './useReplayDriver';
import { getEventGlyph } from '../../shared/eventGlyphs';
import { colors } from '../../../constants/styles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4, 'instant'];

function formatSpeedLabel(speed: ReplaySpeed): string {
  return speed === 'instant' ? '⚡' : `${speed}×`;
}

// ---------------------------------------------------------------------------
// Styles (60px strip per PIPELINES_PLAN.md §18.5)
// ---------------------------------------------------------------------------

const scrubberStyle: CSSProperties = {
  height: 60,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 16px',
  background: colors.surface,
  borderTop: `1px solid ${colors.border}`,
};

const scrubberBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  background: 'transparent',
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  color: colors.textSecondary,
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const scrubberBtnDisabledStyle: CSSProperties = {
  ...scrubberBtnStyle,
  cursor: 'not-allowed',
  opacity: 0.5,
};

const scrubberBtnActiveStyle: CSSProperties = {
  ...scrubberBtnStyle,
  background: colors.primary,
  color: '#ffffff',
  borderColor: colors.primary,
};

const speedPillStyle: CSSProperties = {
  fontSize: 11,
  color: colors.textSecondary,
  padding: '2px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  fontFamily: 'inherit',
  background: 'transparent',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const speedPillActiveStyle: CSSProperties = {
  ...speedPillStyle,
  background: colors.primary,
  color: '#ffffff',
  borderColor: colors.primary,
  fontWeight: 600,
};

const scrubberTrackStyle: CSSProperties = {
  flex: 1,
  height: 4,
  borderRadius: 2,
  background: colors.border,
  position: 'relative',
  overflow: 'visible',
};

const scrubberFillStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  background:
    'linear-gradient(to right, rgba(100,108,255,0.25), rgba(100,108,255,0.1))',
};

const scrubberReadoutStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  color: colors.textSecondary,
  minWidth: 90,
  textAlign: 'right',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ScrubberProps {
  replay: ReplayDriver;
}

export default function Scrubber({ replay }: ScrubberProps) {
  const { state, play, pause, stop, seek, setSpeed, events } = replay;
  const { playing, cursor, totalEvents, speedMultiplier } = state;
  const hasEvents = totalEvents > 0;
  const fillPct = hasEvents
    ? Math.min(100, (cursor / totalEvents) * 100)
    : 0;

  return (
    <div style={scrubberStyle} data-testid="replay-scrubber">
      <button
        type="button"
        style={
          !hasEvents
            ? scrubberBtnDisabledStyle
            : playing
              ? scrubberBtnStyle
              : scrubberBtnActiveStyle
        }
        onClick={play}
        disabled={!hasEvents || playing}
        title="Play"
        aria-label="Play"
        data-testid="replay-play"
      >
        ▶
      </button>
      <button
        type="button"
        style={
          !hasEvents || !playing ? scrubberBtnDisabledStyle : scrubberBtnStyle
        }
        onClick={pause}
        disabled={!hasEvents || !playing}
        title="Pause"
        aria-label="Pause"
        data-testid="replay-pause"
      >
        ❚❚
      </button>
      <button
        type="button"
        style={!hasEvents ? scrubberBtnDisabledStyle : scrubberBtnStyle}
        onClick={stop}
        disabled={!hasEvents}
        title="Stop"
        aria-label="Stop"
        data-testid="replay-stop"
      >
        ◼
      </button>

      {SPEEDS.map((s) => (
        <button
          key={String(s)}
          type="button"
          style={speedMultiplier === s ? speedPillActiveStyle : speedPillStyle}
          onClick={() => setSpeed(s)}
          title={`Playback speed ${formatSpeedLabel(s)}`}
          data-testid={`replay-speed-${s}`}
        >
          {formatSpeedLabel(s)}
        </button>
      ))}

      <div
        style={{
          ...scrubberTrackStyle,
          cursor: hasEvents ? 'pointer' : 'default',
        }}
        data-testid="replay-track"
      >
        <div style={{ ...scrubberFillStyle, width: `${fillPct}%` }} />
        {events.map((evt, idx) => {
          const glyph = getEventGlyph(evt.eventType);
          const leftPct =
            totalEvents > 1 ? (idx / (totalEvents - 1)) * 100 : 50;
          return (
            <button
              key={`${evt.seq}-${evt.eventType}`}
              type="button"
              onClick={() => seek(idx)}
              aria-label={`Seek to ${evt.eventType}`}
              title={evt.eventType}
              data-testid={`replay-tick-${idx}`}
              style={{
                position: 'absolute',
                top: -4,
                left: `calc(${leftPct}% - 4px)`,
                width: 8,
                height: 12,
                padding: 0,
                border: 'none',
                borderRadius: 2,
                background: glyph.color,
                opacity: idx < cursor ? 1 : 0.45,
                cursor: 'pointer',
              }}
            />
          );
        })}
      </div>

      <div style={scrubberReadoutStyle} data-testid="replay-readout">
        {cursor} / {totalEvents}
      </div>
    </div>
  );
}
