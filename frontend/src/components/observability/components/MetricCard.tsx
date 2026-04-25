// frontend/src/components/observability/components/MetricCard.tsx
//
// Card wrapper for a single metric chart (see PIPELINES_PLAN.md §18.9).
// 10px radius, 1px border, 16px padding; header with title + small time-range
// chip + `⛶` maximize button; body slot for the chart itself.

import type { ReactNode } from 'react';
import { colors } from '../../../constants/styles';

export interface MetricCardProps {
  title: string;
  timeRange?: string;
  children: ReactNode;
  onMaximize?: () => void;
}

function MetricCard({ title, timeRange, children, onMaximize }: MetricCardProps) {
  return (
    <div
      data-testid="metric-card"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
        display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 13, fontWeight: 600, color: colors.textPrimary,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={title}
        >
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {timeRange && (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11, fontWeight: 600,
                background: colors.surfaceHover,
                color: colors.textSecondary,
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
              }}
            >
              {timeRange}
            </span>
          )}
          {onMaximize && (
            <button
              data-testid="metric-card-maximize"
              onClick={onMaximize}
              aria-label={`Maximize ${title}`}
              style={{
                border: 'none', background: 'transparent',
                color: colors.textTertiary, cursor: 'pointer',
                fontSize: 14, padding: '2px 4px', fontFamily: 'inherit',
              }}
            >
              ⛶
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export default MetricCard;
