// frontend/src/components/observability/components/KPICard.tsx
//
// KPI card used on the observability dashboard (§18.6). Renders a title, large
// numeric value, optional delta indicator (up/down %), and optional sparkline.
// Card is clickable when `onClick` is provided — hover draws a primary border.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import Sparkline from '../../shared/Sparkline';
import { colors } from '../../../constants/styles';

export interface KPICardProps {
  title: string;
  value: number | string;
  delta?: { value: number; direction: 'up' | 'down' };
  sparklineData?: number[];
  onClick?: () => void;
}

function formatValue(v: number | string): string {
  if (typeof v === 'number') {
    return v.toLocaleString();
  }
  return v;
}

function KPICard({ title, value, delta, sparklineData, onClick }: KPICardProps) {
  const [hover, setHover] = useState(false);

  const clickable = Boolean(onClick);

  const cardStyle: CSSProperties = {
    flex: 1,
    minWidth: 180,
    background: colors.surface,
    border: `1px solid ${hover && clickable ? colors.primary : colors.border}`,
    borderRadius: 10,
    padding: 16,
    cursor: clickable ? 'pointer' : 'default',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontFamily: 'inherit',
    transition: 'border-color 120ms ease',
  };

  const deltaColor =
    delta?.direction === 'up' ? colors.state.completed : colors.state.failed;
  const deltaArrow = delta?.direction === 'up' ? '▲' : '▼';

  return (
    <div
      data-testid="kpi-card"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={cardStyle}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: colors.textSecondary,
          letterSpacing: 0.2,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: colors.textPrimary,
            lineHeight: 1.1,
          }}
        >
          {formatValue(value)}
        </div>
        {sparklineData && sparklineData.length > 0 && (
          <Sparkline
            data={sparklineData}
            width={80}
            height={20}
            color={colors.primary}
          />
        )}
      </div>
      {delta && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: deltaColor,
            fontFamily: 'inherit',
          }}
        >
          {deltaArrow} {Math.abs(delta.value)}%
        </div>
      )}
    </div>
  );
}

export default KPICard;
