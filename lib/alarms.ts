import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FargateService } from 'aws-cdk-lib/aws-ecs';

export function createAlarms(
  scope: Construct,
  ecsService: FargateService,
  alarmTopic: sns.Topic
): void {

  // 1. Memory Utilization Alarm (>80% for 2 consecutive periods)
  // Create metric manually for ECS service memory utilization
  const memoryMetric = new cloudwatch.Metric({
    namespace: 'AWS/ECS',
    metricName: 'MemoryUtilization',
    dimensionsMap: {
      ServiceName: ecsService.serviceName,
      ClusterName: ecsService.cluster.clusterName,
    },
    statistic: 'Average',
    period: Duration.minutes(5),
  });

  const memoryAlarm = new cloudwatch.Alarm(scope, 'MemoryUtilizationAlarm', {
    alarmName: 'WebSocketGateway-HighMemory',
    alarmDescription: 'ECS task memory utilization exceeds 80%',
    metric: memoryMetric,
    threshold: 80,
    evaluationPeriods: 2,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  memoryAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

  // 2. Connection Failure Alarm (WebSocket connection failures >10/min)
  // Custom metric emitted by application when WebSocket upgrades fail
  const connectionFailureMetric = new cloudwatch.Metric({
    namespace: 'WebSocketGateway',
    metricName: 'ConnectionFailures',
    dimensionsMap: {
      ServiceName: 'websocket-gateway',
    },
    statistic: 'Sum',
    period: Duration.minutes(1),
  });

  const connectionFailureAlarm = new cloudwatch.Alarm(scope, 'ConnectionFailureAlarm', {
    alarmName: 'WebSocketGateway-ConnectionFailures',
    alarmDescription: 'WebSocket connection failures exceed 10 per minute',
    metric: connectionFailureMetric,
    threshold: 10,
    evaluationPeriods: 2,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  connectionFailureAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

  // 3. Authorization Denial Alarm (>5/min indicates attack or misconfiguration)
  const authzDenialMetric = new cloudwatch.Metric({
    namespace: 'WebSocketGateway',
    metricName: 'AuthorizationDenials',
    dimensionsMap: {
      ServiceName: 'websocket-gateway',
    },
    statistic: 'Sum',
    period: Duration.minutes(1),
  });

  const authzDenialAlarm = new cloudwatch.Alarm(scope, 'AuthorizationDenialAlarm', {
    alarmName: 'WebSocketGateway-AuthorizationDenials',
    alarmDescription: 'Authorization denials exceed 5 per minute',
    metric: authzDenialMetric,
    threshold: 5,
    evaluationPeriods: 3, // 3 minutes to avoid false positives
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  authzDenialAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));
}
