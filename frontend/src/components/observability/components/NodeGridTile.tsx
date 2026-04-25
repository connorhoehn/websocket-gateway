// frontend/src/components/observability/components/NodeGridTile.tsx
//
// 200×200 tile summarizing a single cluster node (§18.6 cluster health, §18.7
// node grid). Shows id, role/region tags, CPU%, MEM, CONN, RUNS, CPU sparkline,
// and a subtle [● kill] action (Phase 5 chaos — stub onKill for Phase 1).

import { useState } from 'react';
import type { CSSProperties } from 'react';
import Sparkline from '../../shared/Sparkline';
import { colors } from '../../../constants/styles';

export interface NodeSummary {
  id: string;
  status: 'healthy' | 'degraded' | 'dead' | 'idle';
  region?: string;
  role?: string;
  cpu: number;
  memoryMb: number;
  connections: number;
  activeRuns: number;
  cpuHistory: number[];
}

export interface NodeGridTileProps {
  node: NodeSummary;
  selected?: boolean;
  onClick?: () => void;
  onKill?: () => void;
}

const STATUS_COLOR: Record<NodeSummary['status'], string> = {
  healthy: colors.state.completed,
  degraded: colors.state.awaiting,
  dead: colors.state.failed,
  idle: colors.state.idle,
};

function formatMem(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}G`;
  }
  return `${Math.round(mb)}M`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontSize: 12,
        fontFamily: 'inherit',
      }}
    >
      <span style={{ color: colors.textSecondary, fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ color: colors.textPrimary, fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11 }}>
        {value}
      </span>
    </div>
  );
}

function NodeGridTile({ node, selected, onClick, onKill }: NodeGridTileProps) {
  const [hover, setHover] = useState(false);

  const statusColor = STATUS_COLOR[node.status];

  const tileStyle: CSSProperties = {
    width: 200,
    height: 200,
    background: colors.surface,
    border: `1px solid ${selected ? colors.primary : statusColor}`,
    boxShadow: selected
      ? '0 0 0 4px rgba(100, 108, 255, 0.18)'
      : hover
      ? '0 2px 8px rgba(100, 108, 255, 0.10)'
      : 'none',
    borderRadius: 10,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    cursor: onClick ? 'pointer' : 'default',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    transition: 'box-shadow 120ms ease, border-color 120ms ease',
  };

  const runsText =
    node.activeRuns > 0
      ? `${node.activeRuns}`
      : '— idle';

  return (
    <div
      data-testid="node-grid-tile"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={tileStyle}
    >
      {/* Header: id + status dot */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.id}
        >
          {node.id}
        </div>
        <span
          role="img"
          aria-label={`status ${node.status}`}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Role + region tags */}
      {(node.role || node.region) && (
        <div
          style={{
            fontSize: 11,
            color: colors.textTertiary,
            fontFamily: 'inherit',
          }}
        >
          {[node.role, node.region].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Stat label="CPU" value={`${Math.round(node.cpu)}%`} />
        <Stat label="MEM" value={formatMem(node.memoryMb)} />
        <Stat label="CONN" value={`${node.connections}`} />
        <Stat label="RUNS" value={runsText} />
      </div>

      {/* CPU sparkline */}
      <div style={{ marginTop: 'auto' }}>
        <Sparkline
          data={node.cpuHistory}
          width={176}
          height={18}
          color={colors.primary}
        />
      </div>

      {/* Kill button (Phase 5 stub) */}
      {onKill && (
        <button
          data-testid="node-kill-btn"
          onClick={(e) => {
            e.stopPropagation();
            onKill();
          }}
          style={{
            alignSelf: 'flex-start',
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 600,
            background: 'transparent',
            color: colors.textTertiary,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ● kill
        </button>
      )}
    </div>
  );
}

export default NodeGridTile;
