// frontend/src/components/observability/components/ActiveRunsTable.tsx
//
// Compact table listing active pipeline runs on the dashboard (§18.6).
// Columns: pipeline name · step indicator · owner node · elapsed.
// Empty state: "No active runs".
//
// Rows are clickable: click / Enter / Space drills into the per-run replay
// page (`/pipelines/:pipelineId/runs/:runId`). Per-row action controls (e.g.
// the cancel button) call `e.stopPropagation()` so they don't trigger row
// navigation.

import { useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
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
  /**
   * Invoked when a row is activated (click, Enter, or Space). Wire this to a
   * `useNavigate(...)` call to drill into the per-run detail page.
   */
  onRowClick?: (run: ActiveRunRow) => void;
  /**
   * Optional: invoked when the per-row cancel control is activated. The cancel
   * button stops event propagation so it does not also trigger `onRowClick`.
   */
  onCancelRun?: (run: ActiveRunRow) => void;
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
  onCancel,
}: {
  run: ActiveRunRow;
  onClick?: (r: ActiveRunRow) => void;
  onCancel?: (r: ActiveRunRow) => void;
}) {
  const [hover, setHover] = useState(false);

  const interactive = Boolean(onClick);
  const ariaLabel = interactive
    ? `Open run ${run.runId} of pipeline ${run.pipelineName}`
    : undefined;

  // Enter / Space activate the row exactly like a click would. We swallow the
  // default Space behavior (which would otherwise scroll the page).
  const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onClick(run);
    }
  };

  const handleCancelClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Critical: prevent the row's onClick from firing. Cancelling a run is
    // intentionally distinct from drilling into it.
    e.stopPropagation();
    if (onCancel) onCancel(run);
  };

  const isCancellable = Boolean(onCancel) && run.status === 'running';

  return (
    <tr
      data-testid="active-run-row"
      role={interactive ? 'button' : undefined}
      aria-label={ariaLabel}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick ? () => onClick(run) : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? colors.surfaceHover : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
        outline: 'none',
      }}
    >
      <td style={{ ...tdStyle, fontWeight: 600 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {run.pipelineName}
          {/* Hover-only external-link affordance next to the runId. */}
          {hover && interactive && (
            <span
              data-testid="active-run-link-icon"
              aria-hidden="true"
              style={{
                fontSize: 11,
                color: colors.primary,
                fontWeight: 500,
              }}
            >
              ↗
            </span>
          )}
        </span>
      </td>
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
      {onCancel && (
        <td
          style={{
            ...tdStyle,
            textAlign: 'right',
            width: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {isCancellable && (
            <button
              data-testid="active-run-cancel"
              type="button"
              aria-label={`Cancel run ${run.runId}`}
              onClick={handleCancelClick}
              // Also block keydown bubbling so Enter/Space on the button
              // doesn't activate the row's keyboard handler.
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                background: 'transparent',
                color: colors.state.failed,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function ActiveRunsTable({ runs, onRowClick, onCancelRun }: ActiveRunsTableProps) {
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
            {onCancelRun && <th style={{ ...thStyle, textAlign: 'right' }} />}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Row
              key={run.runId}
              run={run}
              onClick={onRowClick}
              onCancel={onCancelRun}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ActiveRunsTable;
