// frontend/src/components/observability/components/AlertsPanel.tsx
//
// Vertical list of active alerts (§18.6 Alerts panel). Each item has a
// severity icon, colored left border, message, relative timestamp, and a
// dismiss button. Empty state: centered "No active alerts" in gray.

import type { CSSProperties } from 'react';
import { colors } from '../../../constants/styles';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  category?: string;
}

export interface AlertsPanelProps {
  alerts: Alert[];
  onDismiss?: (id: string) => void;
}

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  info: colors.state.running,
  warning: colors.state.awaiting,
  error: colors.state.failed,
  critical: colors.state.failed,
};

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
  critical: '✕',
};

function relativeTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const diffDays = Math.floor(diffSec / 86400);
  if (diffDays < 3) return `${diffDays}d ago`;
  try {
    return new Date(t).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function AlertItem({
  alert,
  onDismiss,
}: {
  alert: Alert;
  onDismiss?: (id: string) => void;
}) {
  const color = SEVERITY_COLOR[alert.severity];
  const icon = SEVERITY_ICON[alert.severity];

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 12px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${color}`,
    borderRadius: 6,
    fontFamily: 'inherit',
  };

  return (
    <div data-testid="alert-item" style={rowStyle}>
      <span
        aria-hidden="true"
        style={{
          color,
          fontSize: 14,
          lineHeight: '20px',
          flexShrink: 0,
          width: 16,
          textAlign: 'center',
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: colors.textPrimary,
            lineHeight: 1.4,
          }}
        >
          {alert.message}
        </div>
        <div
          style={{
            fontSize: 11,
            color: colors.textTertiary,
            marginTop: 2,
          }}
        >
          {alert.category ? `${alert.category} · ` : ''}
          {relativeTimestamp(alert.timestamp)}
        </div>
      </div>
      {onDismiss && (
        <button
          data-testid="alert-dismiss"
          aria-label="dismiss alert"
          onClick={() => onDismiss(alert.id)}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textTertiary,
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '2px 6px',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function AlertsPanel({ alerts, onDismiss }: AlertsPanelProps) {
  if (!alerts || alerts.length === 0) {
    return (
      <div
        data-testid="alerts-empty"
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
        No active alerts
      </div>
    );
  }

  return (
    <div
      data-testid="alerts-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {alerts.map((a) => (
        <AlertItem key={a.id} alert={a} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export default AlertsPanel;
