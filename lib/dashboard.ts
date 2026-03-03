import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IService, ICluster } from 'aws-cdk-lib/aws-ecs';
import { CfnReplicationGroup } from 'aws-cdk-lib/aws-elasticache';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface DashboardProps {
  ecsService: IService;
  ecsCluster: ICluster;
  redisCluster?: CfnReplicationGroup;
  alb: ApplicationLoadBalancer;
}

export function createDashboard(
  scope: Construct,
  props: DashboardProps
): cloudwatch.Dashboard {
  const dashboard = new cloudwatch.Dashboard(scope, 'OperationalDashboard', {
    dashboardName: 'WebSocketGateway-Operations',
  });

  // Row 1: Connection Metrics (2 widgets)
  const activeConnectionsWidget = new cloudwatch.GraphWidget({
    title: 'Active WebSocket Connections',
    left: [
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'activeConnections',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
    ],
    width: 12,
  });

  const connectionRateWidget = new cloudwatch.GraphWidget({
    title: 'Connection Rate (Connects/Disconnects)',
    left: [
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'ConnectionFailures',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        label: 'Failures',
        color: cloudwatch.Color.RED,
      }),
    ],
    width: 12,
  });

  dashboard.addWidgets(activeConnectionsWidget, connectionRateWidget);

  // Row 2: Message Throughput and Latency
  const messageThroughputWidget = new cloudwatch.GraphWidget({
    title: 'Message Throughput',
    left: [
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'messagesPerSecond',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
    ],
    width: 12,
  });

  const latencyWidget = new cloudwatch.GraphWidget({
    title: 'Message Processing Latency (P95)',
    left: [
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'p95Latency',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
      }),
    ],
    width: 12,
    leftYAxis: {
      label: 'Milliseconds',
      showUnits: false,
    },
  });

  dashboard.addWidgets(messageThroughputWidget, latencyWidget);

  // Row 3: Error Rates
  const errorRateWidget = new cloudwatch.GraphWidget({
    title: 'Error Rates by Type',
    left: [
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'AuthorizationDenials',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        label: 'Authorization Denials',
        color: cloudwatch.Color.ORANGE,
      }),
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'ValidationErrors',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        label: 'Validation Errors',
        color: cloudwatch.Color.RED,
      }),
      new cloudwatch.Metric({
        namespace: 'WebSocketGateway',
        metricName: 'RateLimitExceeded',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        label: 'Rate Limit Exceeded',
        color: cloudwatch.Color.PURPLE,
      }),
    ],
    width: 24,
  });

  dashboard.addWidgets(errorRateWidget);

  // Row 4: ECS Resource Utilization
  const cpuWidget = new cloudwatch.GraphWidget({
    title: 'ECS CPU Utilization',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
        dimensionsMap: {
          ServiceName: props.ecsService.serviceName,
          ClusterName: props.ecsCluster.clusterName,
        },
      }),
    ],
    width: 12,
    leftYAxis: {
      label: 'Percent',
      max: 100,
    },
  });

  const memoryWidget = new cloudwatch.GraphWidget({
    title: 'ECS Memory Utilization',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'MemoryUtilization',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
        dimensionsMap: {
          ServiceName: props.ecsService.serviceName,
          ClusterName: props.ecsCluster.clusterName,
        },
      }),
    ],
    width: 12,
    leftYAxis: {
      label: 'Percent',
      max: 100,
    },
  });

  dashboard.addWidgets(cpuWidget, memoryWidget);

  // Row 5: Redis Health (only if Redis is enabled)
  if (props.redisCluster) {
    const redisConnectionsWidget = new cloudwatch.GraphWidget({
      title: 'Redis Connections',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName: 'CurrConnections',
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
          dimensionsMap: {
            ReplicationGroupId: props.redisCluster.replicationGroupId || 'websocket-redis',
          },
        }),
      ],
      width: 12,
    });

    const redisNetworkWidget = new cloudwatch.GraphWidget({
      title: 'Redis Network Throughput',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName: 'NetworkBytesIn',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          dimensionsMap: {
            ReplicationGroupId: props.redisCluster.replicationGroupId || 'websocket-redis',
          },
          label: 'Bytes In',
        }),
        new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName: 'NetworkBytesOut',
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
          dimensionsMap: {
            ReplicationGroupId: props.redisCluster.replicationGroupId || 'websocket-redis',
          },
          label: 'Bytes Out',
        }),
      ],
      width: 12,
    });

    dashboard.addWidgets(redisConnectionsWidget, redisNetworkWidget);
  }

  // Row 6: ALB Health
  const albResponseTimeWidget = new cloudwatch.GraphWidget({
    title: 'ALB Response Time',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
        },
      }),
    ],
    width: 12,
  });

  const albHealthyHostsWidget = new cloudwatch.GraphWidget({
    title: 'ALB Healthy Targets',
    left: [
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HealthyHostCount',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
        },
      }),
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'UnHealthyHostCount',
        statistic: 'Average',
        period: cdk.Duration.minutes(1),
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
        },
        color: cloudwatch.Color.RED,
      }),
    ],
    width: 12,
  });

  dashboard.addWidgets(albResponseTimeWidget, albHealthyHostsWidget);

  return dashboard;
}
