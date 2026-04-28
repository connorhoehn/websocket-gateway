// frontend/src/components/shared/Chart.tsx
//
// Thin wrapper around recharts that applies the app's styling defaults
// (per PIPELINES_PLAN.md §18.9, §19.5). MetricsPage uses these wrappers
// so individual cards don't each re-import recharts primitives and repeat
// the same axis/tooltip/legend boilerplate.
//
// NOTE: The palette uses `colors.state.awaiting` for the amber/warning slot
// (the design tokens in constants/styles.ts do not ship a dedicated
// `colors.state.warning`; `awaiting` is the semantic amber).

import type { CSSProperties, JSX } from 'react';
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart as RLineChart,
  AreaChart as RAreaChart,
  BarChart as RBarChart,
  Line,
  Area,
  Bar,
} from 'recharts';
import { colors } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LineSeries {
  label: string;
  data: Array<{ x: number | string; y: number }>;
  color?: string;
}

// ---------------------------------------------------------------------------
// Shared styling defaults
// ---------------------------------------------------------------------------

const DEFAULT_HEIGHT = 180;

// Palette used for multi-series charts when an individual series does not
// supply its own `color`.
const MULTI_SERIES_PALETTE: string[] = [
  colors.primary,
  colors.state.completed,
  colors.state.awaiting,
  colors.state.failed,
  '#8b5cf6',
];

// Recharts >=3 typed `tick` as their own SVG-text prop shape; the runtime
// still spreads any object onto the rendered <text>, so we widen the literal
// to escape their narrow `TickProp` generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AXIS_TICK_STYLE: any = {
  fontSize: 10,
  fill: colors.textTertiary,
};

const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  fontSize: 10,
  padding: '6px 8px',
  fontFamily: 'inherit',
  color: colors.textPrimary,
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
};

const TOOLTIP_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  color: colors.textSecondary,
  marginBottom: 2,
};

const TOOLTIP_ITEM_STYLE: CSSProperties = {
  fontSize: 10,
  padding: 0,
};

const LEGEND_WRAPPER_STYLE: CSSProperties = {
  fontSize: 11,
  color: colors.textSecondary,
  paddingBottom: 4,
};

// Grid lines use `colors.border` with 0.5 opacity per the spec.
const GRID_STROKE = colors.border;
const GRID_OPACITY = 0.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merge a list of {x, y} series into a single array of rows keyed by `x`,
 * with one column per series label:
 *   [{ x: 0, series0: 1, series1: 2 }, ...]
 * This is the shape recharts expects on its top-level `data` prop.
 */
function mergeSeriesData(series: LineSeries[]): Array<Record<string, number | string>> {
  const xMap = new Map<number | string, Record<string, number | string>>();
  const xOrder: Array<number | string> = [];

  series.forEach((s) => {
    s.data.forEach((point) => {
      let row = xMap.get(point.x);
      if (!row) {
        row = { x: point.x };
        xMap.set(point.x, row);
        xOrder.push(point.x);
      }
      row[s.label] = point.y;
    });
  });

  return xOrder.map((x) => xMap.get(x) as Record<string, number | string>);
}

function seriesColor(s: LineSeries, idx: number): string {
  return s.color ?? MULTI_SERIES_PALETTE[idx % MULTI_SERIES_PALETTE.length];
}

// ---------------------------------------------------------------------------
// <LineChart />
// ---------------------------------------------------------------------------

export function LineChart({
  series,
  height = DEFAULT_HEIGHT,
  yFormat,
  xFormat,
}: {
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number | string) => string;
}): JSX.Element {
  const data = mergeSeriesData(series);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeOpacity={GRID_OPACITY}
          vertical={false}
        />
        <XAxis
          dataKey="x"
          tick={AXIS_TICK_STYLE}
          stroke={colors.border}
          tickFormatter={xFormat}
          minTickGap={16}
        />
        <YAxis
          tick={AXIS_TICK_STYLE}
          stroke={colors.border}
          tickFormatter={yFormat}
          width={yFormat ? 56 : 40}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelFormatter={(label) =>
            xFormat ? xFormat(label as number | string) : String(label)
          }
          formatter={((value: unknown) => {
            const num = typeof value === 'number' ? value : Number(value);
            return yFormat && Number.isFinite(num) ? yFormat(num) : String(value);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any}
        />
        <Legend
          verticalAlign="top"
          align="left"
          layout="horizontal"
          wrapperStyle={LEGEND_WRAPPER_STYLE}
          iconSize={8}
        />
        {series.map((s, i) => (
          <Line
            key={s.label}
            type="monotone"
            dataKey={s.label}
            name={s.label}
            stroke={seriesColor(s, i)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </RLineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// <StackedAreaChart />
// ---------------------------------------------------------------------------

export function StackedAreaChart({
  series,
  height = DEFAULT_HEIGHT,
}: {
  series: LineSeries[];
  height?: number;
}): JSX.Element {
  const data = mergeSeriesData(series);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RAreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeOpacity={GRID_OPACITY}
          vertical={false}
        />
        <XAxis
          dataKey="x"
          tick={AXIS_TICK_STYLE}
          stroke={colors.border}
          minTickGap={16}
        />
        <YAxis tick={AXIS_TICK_STYLE} stroke={colors.border} width={40} />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
        />
        <Legend
          verticalAlign="top"
          align="left"
          layout="horizontal"
          wrapperStyle={LEGEND_WRAPPER_STYLE}
          iconSize={8}
        />
        {series.map((s, i) => {
          const color = seriesColor(s, i);
          return (
            <Area
              key={s.label}
              type="monotone"
              dataKey={s.label}
              name={s.label}
              stackId="1"
              stroke={color}
              strokeWidth={2}
              fill={color}
              fillOpacity={0.25}
              isAnimationActive={false}
            />
          );
        })}
      </RAreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// <BarChart />
// ---------------------------------------------------------------------------

export function BarChart({
  data,
  height = DEFAULT_HEIGHT,
  xKey,
  yKey,
  color,
  yFormat,
}: {
  data: Array<Record<string, unknown>>;
  height?: number;
  xKey: string;
  yKey: string;
  color?: string;
  yFormat?: (v: number) => string;
}): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeOpacity={GRID_OPACITY}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tick={AXIS_TICK_STYLE}
          stroke={colors.border}
          minTickGap={16}
        />
        <YAxis
          tick={AXIS_TICK_STYLE}
          stroke={colors.border}
          tickFormatter={yFormat}
          width={yFormat ? 56 : 40}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          formatter={((value: unknown) => {
            const num = typeof value === 'number' ? value : Number(value);
            return yFormat && Number.isFinite(num) ? yFormat(num) : String(value);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any}
        />
        <Legend
          verticalAlign="top"
          align="left"
          layout="horizontal"
          wrapperStyle={LEGEND_WRAPPER_STYLE}
          iconSize={8}
        />
        <Bar
          dataKey={yKey}
          name={yKey}
          fill={color ?? colors.primary}
          isAnimationActive={false}
        />
      </RBarChart>
    </ResponsiveContainer>
  );
}

export default LineChart;
