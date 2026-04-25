// frontend/src/components/observability/components/MetricsGraph.tsx
//
// Phase 1 placeholder chart card. Renders a title and a <Sparkline> per series
// (or a single `data` array). Per PIPELINES_PLAN.md §18.9 — real charting
// library swap lands in Phase 4.

import Sparkline from '../../shared/Sparkline';
import { colors } from '../../../constants/styles';

export interface MetricsGraphSeries {
  label: string;
  data: number[];
  color?: string;
}

export interface MetricsGraphProps {
  title: string;
  data?: number[];
  series?: MetricsGraphSeries[];
  yLabel?: string;
}

function MetricsGraph({ title, data, series, yLabel }: MetricsGraphProps) {
  const resolvedSeries: MetricsGraphSeries[] =
    series && series.length > 0
      ? series
      : data
        ? [{ label: title, data, color: colors.primary }]
        : [];

  return (
    <div
      data-testid="metrics-graph"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        fontFamily: 'inherit', fontSize: 13, color: colors.textPrimary,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
          {title}
        </div>
        {yLabel && (
          <div style={{ fontSize: 11, color: colors.textTertiary }}>{yLabel}</div>
        )}
      </div>

      <div
        style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          background: colors.surfaceInset, border: `1px solid ${colors.border}`,
          borderRadius: 6, padding: '10px 12px',
        }}
      >
        {resolvedSeries.length === 0 ? (
          <div style={{ fontSize: 12, color: colors.textTertiary }}>No data</div>
        ) : (
          resolvedSeries.map((s) => (
            <div
              key={s.label}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div
                style={{
                  fontSize: 11, color: colors.textSecondary,
                  width: 80, flexShrink: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={s.label}
              >
                {s.label}
              </div>
              <Sparkline
                data={s.data}
                width={180}
                height={28}
                color={s.color ?? colors.primary}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default MetricsGraph;
