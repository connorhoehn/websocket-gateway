// frontend/src/components/observability/components/ActiveRunsTable.tsx
//
// Compact table listing active pipeline runs on the dashboard (§18.6).
// Columns: pipeline name · step indicator · owner node · elapsed.
// Empty state: "No active runs".

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { colors } from '../../../constants/styles';

export interface ActiveRunRow {
  pipelineId: string;
  pipelineName: string;
  runId: string;
  currentStep: string;
  ownerNode: string;
  elapsed: string;
  status: string;
}

export interface ActiveRunsTableProps {
  runs: ActiveRunRow[];
  onRowClick?: (run: ActiveRunRow) => void;
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  background: colors.surfaceInset,
  borderBottom: `1px solid ${colors.border}`,
};

const tdStyle: CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  color: colors.textPrimary,
  fontFamily: 'inherit',
  borderBottom: `1px solid ${colors.border}`,
};

function Row({
  run,
  onClick,
}: {
  run: ActiveRunRow;
  onClick?: (r: ActiveRunRow) => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <tr
      data-testid="active-run-row"
      onClick={onClick ? () => onClick(run) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? colors.surfaceHover : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <td style={{ ...tdStyle, fontWeight: 600 }}>{run.pipelineName}</td>
      <td
        style={{
          ...tdStyle,
          color: colors.textSecondary,
          fontFamily: 'SF Mono, Menlo, monospace',
          fontSize: 11,
        }}
      >
        {run.currentStep}
      </td>
      <td
        style={{
          ...tdStyle,
          color: colors.textSecondary,
          fontFamily: 'SF Mono, Menlo, monospace',
          fontSize: 11,
        }}
      >
        {run.ownerNode}
      </td>
      <td
        style={{
          ...tdStyle,
          color: colors.textSecondary,
          fontFamily: 'SF Mono, Menlo, monospace',
          fontSize: 11,
          textAlign: 'right',
        }}
      >
        {run.elapsed}
      </td>
    </tr>
  );
}

function ActiveRunsTable({ runs, onRowClick }: ActiveRunsTableProps) {
  if (!runs || runs.length === 0) {
    return (
      <div
        data-testid="active-runs-empty"
        style={{
          padding: 24,
          textAlign: 'center',
          color: colors.textTertiary,
          fontSize: 13,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          background: colors.surface,
          fontFamily: 'inherit',
        }}
      >
        No active runs
      </div>
    );
  }

  return (
    <div
      data-testid="active-runs-table"
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: colors.surface,
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'inherit',
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>Pipeline</th>
            <th style={thStyle}>Step</th>
            <th style={thStyle}>Owner</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Elapsed</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Row key={run.runId} run={run} onClick={onRowClick} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ActiveRunsTable;
