// frontend/src/components/pipelines/nodes/BaseNode.tsx
//
// Shared visual wrapper for all pipeline node components (per §18.4.4).
// Renders a rounded card with a state-colored border, a header row
// (icon + subtitle + status dot), an optional body preview, an optional
// footer slot (used by LLMNode for the expandable response), and a
// `children` slot for React Flow <Handle> elements.
//
// When `state === 'failed'` and the caller supplies `onRetry`, a small
// "⟳ Retry from here" pill is rendered inline below the header per
// §18.4.4 / §17.6. Clicking it stops propagation so it doesn't select
// the node on the React Flow canvas.

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { colors } from '../../../constants/styles';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NodeExecutionState =
  | 'idle'
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface BaseNodeProps {
  icon: string;
  subtitle?: string;
  state: NodeExecutionState;
  body?: ReactNode;
  footer?: ReactNode;
  selected?: boolean;
  /**
   * When provided AND `state === 'failed'`, renders a small "⟳ Retry from
   * here" pill inline below the header. The click handler is invoked with
   * propagation stopped so the canvas doesn't also receive a node-select.
   * Per PIPELINES_PLAN.md §18.4.4 / §17.6.
   */
  onRetry?: () => void;
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Per-state visual tokens (colors + border-width/style + background)
// Derived from PIPELINES_PLAN.md §7.1.
// ---------------------------------------------------------------------------

interface StateStyle {
  border: string;
  background: string;
  opacity: number;
  dot: string;
}

const STATE_STYLES: Record<NodeExecutionState, StateStyle> = {
  idle:      { border: `1px solid ${colors.state.idle}`,        background: colors.surface,   opacity: 1,   dot: colors.state.idle },
  pending:   { border: `1px dashed ${colors.state.pending}`,    background: '#eff6ff',        opacity: 1,   dot: colors.state.pending },
  running:   { border: `2px solid ${colors.state.running}`,     background: '#eff6ff',        opacity: 1,   dot: colors.state.running },
  awaiting:  { border: `2px solid ${colors.state.awaiting}`,    background: '#fffbeb',        opacity: 1,   dot: colors.state.awaiting },
  completed: { border: `1px solid ${colors.state.completed}`,   background: '#f0fdf4',        opacity: 1,   dot: colors.state.completed },
  failed:    { border: `2px solid ${colors.state.failed}`,      background: '#fef2f2',        opacity: 1,   dot: colors.state.failed },
  skipped:   { border: `1px dashed ${colors.state.skipped}`,    background: '#f9fafb',        opacity: 0.5, dot: colors.state.skipped },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BaseNode(props: BaseNodeProps) {
  const { icon, subtitle, state, body, footer, selected, onRetry, children } = props;
  const tokens = STATE_STYLES[state];
  const reduceMotion = usePrefersReducedMotion();
  const [retryHover, setRetryHover] = useState(false);

  // The retry pill is purely additive: it only renders when the caller supplied
  // an `onRetry` AND the node is currently in the failed state. Per §17.6 the
  // click must NOT also bubble up as a node-select on the React Flow canvas.
  const showRetry = state === 'failed' && typeof onRetry === 'function';
  const handleRetryClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onRetry?.();
  };

  // §18.12 motion system: pending/running pulse on the dot draws attention
  // while the node waits to execute or is executing. The status color itself
  // still communicates the state — the animation is purely additive. When
  // the user prefers reduced motion we skip the pulse entirely and rely on
  // color + the per-state border weight to convey state.
  const pulseAnim =
    !reduceMotion && state === 'pending'
      ? 'basenode-pulse 2000ms cubic-bezier(0.25, 0.1, 0.25, 1) infinite'
      : !reduceMotion && state === 'running'
        ? 'basenode-pulse 1500ms linear infinite'
        : 'none';

  const cardStyle: CSSProperties = {
    width: 200,
    borderRadius: 8,
    border: tokens.border,
    background: tokens.background,
    opacity: tokens.opacity,
    boxShadow: selected
      ? '0 0 0 4px rgba(100, 108, 255, 0.18), 0 1px 2px rgba(15, 23, 42, 0.06)'
      : '0 1px 2px rgba(15, 23, 42, 0.06)',
    position: 'relative',
    fontFamily: 'inherit',
    color: colors.textPrimary,
    boxSizing: 'border-box',
    // 200ms snap transition between state colors — matches §18.12. Disabled
    // under reduced-motion so the change is instant.
    transition: reduceMotion
      ? 'none'
      : 'border-color 200ms cubic-bezier(0.4, 0, 0.2, 1), background-color 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    height: 28, padding: '0 10px',
    borderBottom: body || footer || showRetry ? `1px solid ${colors.border}` : 'none',
  };

  // §17.6 retry pill — small inline button just below the header, matching the
  // failed-state palette. Transparent background with a red border + label;
  // hover darkens to the same `#fef2f2` we use for the failed card background
  // so the pill visually nests inside the card. Reduced-motion-friendly: no
  // animation here, just a snap on hover.
  const retryRowStyle: CSSProperties = {
    display: 'flex',
    padding: '6px 10px',
    borderBottom: body || footer ? `1px solid ${colors.border}` : 'none',
  };

  const retryPillStyle: CSSProperties = {
    cursor: 'pointer',
    appearance: 'none',
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.2,
    padding: '2px 8px',
    borderRadius: 999,
    border: `1px solid ${colors.state.failed}`,
    color: colors.state.failed,
    background: retryHover ? '#fef2f2' : 'transparent',
    transition: reduceMotion
      ? 'none'
      : 'background-color 120ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const iconStyle: CSSProperties = {
    fontSize: 14, lineHeight: 1, flexShrink: 0,
  };

  const subtitleStyle: CSSProperties = {
    flex: 1, minWidth: 0,
    fontSize: 12, fontWeight: 600, color: colors.textPrimary,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };

  const dotStyle: CSSProperties = {
    width: 8, height: 8, borderRadius: '50%',
    background: tokens.dot, flexShrink: 0,
    animation: pulseAnim,
  };

  const bodyStyle: CSSProperties = {
    padding: '8px 10px',
    fontSize: 13, lineHeight: 1.4,
    color: colors.textSecondary,
  };

  const footerStyle: CSSProperties = {
    borderTop: `1px solid ${colors.border}`,
    padding: '6px 10px',
    fontSize: 12,
    color: colors.textSecondary,
  };

  return (
    <div style={cardStyle} data-state={state}>
      {/* Keyframes for the pending/running dot pulse. Injected per-node
          render; the browser dedupes identical @keyframes so this stays
          cheap. See PIPELINES_PLAN.md §18.12. */}
      <style>{`
        @keyframes basenode-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);   }
          50%      { opacity: 0.55; transform: scale(1.25); }
        }
      `}</style>
      <div style={headerStyle}>
        <span style={iconStyle} aria-hidden="true">{icon}</span>
        <span style={subtitleStyle}>{subtitle}</span>
        <span style={dotStyle} aria-label={`state: ${state}`} />
      </div>
      {showRetry && (
        <div style={retryRowStyle}>
          <button
            type="button"
            style={retryPillStyle}
            onClick={handleRetryClick}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setRetryHover(true)}
            onMouseLeave={() => setRetryHover(false)}
            aria-label="Retry from here"
          >
            ⟳ Retry from here
          </button>
        </div>
      )}
      {body !== undefined && body !== null && <div style={bodyStyle}>{body}</div>}
      {footer !== undefined && footer !== null && <div style={footerStyle}>{footer}</div>}
      {children}
    </div>
  );
}
