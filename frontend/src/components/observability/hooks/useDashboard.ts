import {
  useObservability,
  type ClusterDashboard,
} from '../context/ObservabilityContext';

export function useDashboard(): ClusterDashboard | null {
  return useObservability().dashboard;
}

export default useDashboard;
