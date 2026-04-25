// frontend/src/components/observability/hooks/useAlertToasts.ts
//
// Surfaces cluster dashboard alerts as toasts. Dedupes on `(severity + message)`
// so the same persistent alert doesn't re-toast on every poll cycle. Maps
// severity -> toast type. When an alert is resolved (drops off the dashboard),
// its key is removed from the seen-set so a recurrence will toast again.

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../shared/ToastProvider';
import type { ToastOptions } from '../../shared/ToastProvider';
import type { ToastType } from '../../shared/Toast';
import { useObservability } from '../context/ObservabilityContext';
import type { ClusterDashboard } from '../context/ObservabilityContext';

type AlertSeverity = ClusterDashboard['alerts'][number]['severity'];

interface SeverityConfig {
  type: ToastType;
  durationMs: number;
}

const SEVERITY_CONFIG: Record<AlertSeverity, SeverityConfig> = {
  info:     { type: 'info',    durationMs: 4000 },
  warning:  { type: 'warning', durationMs: 6000 },
  error:    { type: 'error',   durationMs: 8000 },
  critical: { type: 'error',   durationMs: 10000 },
};

function alertKey(severity: AlertSeverity, message: string): string {
  return `${severity}:${message}`;
}

/**
 * Subscribes to cluster dashboard alerts and pops a toast for each newly-seen
 * alert. Persistent alerts (still present across polls) are deduped; resolved
 * alerts are cleared from the seen-set so a recurrence will re-toast.
 */
export function useAlertToasts(): void {
  const { dashboard } = useObservability();
  const { toast } = useToast();
  const navigate = useNavigate();
  const seenAlertsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!dashboard) return;

    const currentKeys = new Set<string>();
    for (const alert of dashboard.alerts) {
      const key = alertKey(alert.severity, alert.message);
      currentKeys.add(key);

      if (seenAlertsRef.current.has(key)) continue;

      const cfg = SEVERITY_CONFIG[alert.severity];
      const opts: ToastOptions = {
        type: cfg.type,
        durationMs: cfg.durationMs,
      };
      if (alert.severity === 'critical') {
        opts.actionLabel = 'View';
        opts.onAction = () => navigate('/observability');
      }
      toast(alert.message, opts);
      seenAlertsRef.current.add(key);
    }

    // Drop keys for alerts that are no longer present so a recurrence retoasts.
    for (const key of seenAlertsRef.current) {
      if (!currentKeys.has(key)) {
        seenAlertsRef.current.delete(key);
      }
    }
  }, [dashboard, toast, navigate]);
}
