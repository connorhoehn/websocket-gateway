import { useEffect, useState } from 'react';
import {
  useObservability,
  type ClusterDashboard,
} from '../context/ObservabilityContext';

/**
 * Rolling ring buffer of recent dashboard snapshots, used by MetricsPage for
 * time-series rendering. Grows up to `windowSize` entries, then discards the
 * oldest.
 */
export function useMetricsHistory(windowSize = 60): ClusterDashboard[] {
  const { dashboard } = useObservability();
  const [history, setHistory] = useState<ClusterDashboard[]>([]);

  useEffect(() => {
    if (!dashboard) return;
    setHistory((prev) => [...prev, dashboard].slice(-windowSize));
  }, [dashboard, windowSize]);

  return history;
}

export default useMetricsHistory;
