// TODO: replace with real `ClusterDashboard` type from distributed-core in Phase 2.
// Using a minimal inline shape (loosely typed) so the scaffold compiles without
// pulling distributed-core types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClusterDashboard = any;

export const dashboardFixture: ClusterDashboard = {
  overview: {
    totalNodes: 3,
    healthyNodes: 3,
    totalResources: 0,
    totalConnections: 0,
    messagesPerSecond: 0,
    averageLatency: 0,
    clusterHealth: 'healthy',
  },
  regions: {},
  hotspots: {
    highTrafficResources: [],
    overloadedNodes: [],
  },
  trends: {
    connectionGrowth: 0,
    messageVolumeGrowth: 0,
    nodeHealthTrend: 'stable',
  },
  alerts: [],
};

export default dashboardFixture;
