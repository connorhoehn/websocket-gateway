import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createTaskDefinition } from './task-definition';
import { createFargateService } from './fargate-service';
import { createAlarmTopic } from './sns';
import { WebSocketGatewayObservability } from './observability-construct';
import { RedisService } from './redis-service';
import { SharedInfraStack } from './shared-infra-stack';

export interface WebsocketGatewayStackProps extends StackProps {
  sharedInfra: SharedInfraStack;
}

export class WebsocketGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props: WebsocketGatewayStackProps) {
    super(scope, id, props);

    const { vpc, cluster, cognito, crdtTable, crdtTableName, namespace } = props.sharedInfra;

    // ---- Redis ECS Service (reusable construct) ----
    const redis = new RedisService(this, 'Redis', {
      vpc,
      cluster,
      namespace,
    });

    // ---- WebSocket app task definition (connects to redis.ws.local:6379) ----
    const taskDef = createTaskDefinition(this, {
      dynamodbTableName: crdtTableName,
      cognitoUserPoolId: cognito.userPool.userPoolId,
      cognitoRegion: this.region,
      redisEndpoint: 'redis.ws.local',
    });

    // Grant task role permissions to access DynamoDB table
    crdtTable.grantReadWriteData(taskDef.taskRole);

    const fargateResources = createFargateService(this, {
      vpc,
      cluster,
      taskDef,
      redisSecurityGroup: redis.securityGroup,
    });

    // Ensure WebSocket service starts after Redis is registered in Cloud Map
    fargateResources.service.node.addDependency(redis.service);

    // Allow ECS tasks to reach Redis
    redis.allowFrom(fargateResources.securityGroup);

    // Create SNS topic for alarms
    const alarmEmail = process.env.ALARM_EMAIL;
    const alarmTopic = createAlarmTopic(this, alarmEmail);

    // Create CloudWatch dashboard + alarms via the observability construct.
    new WebSocketGatewayObservability(this, 'Observability', {
      service: fargateResources.service,
      cluster,
      alb: fargateResources.alb,
      snsTopic: alarmTopic,
    });

    // ---- Outputs ----
    new CfnOutput(this, 'WebSocketURL', {
      value: `wss://${fargateResources.alb.loadBalancerDnsName}`,
    });

    new CfnOutput(this, 'DashboardURL', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=WebSocketGateway-Operations`,
      description: 'CloudWatch Dashboard URL',
    });

    new CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic ARN for CloudWatch alarms',
    });

    new CfnOutput(this, 'TaskDefinitionArn', {
      value: taskDef.taskDefinitionArn,
      description: 'Task Definition ARN',
    });

    new CfnOutput(this, 'ServiceArn', {
      value: fargateResources.service.serviceArn,
      description: 'Fargate Service ARN',
    });

    new CfnOutput(this, 'LoadBalancerArn', {
      value: fargateResources.alb.loadBalancerArn,
      description: 'Application Load Balancer ARN',
    });

    new CfnOutput(this, 'SecurityGroupId', {
      value: fargateResources.securityGroup.securityGroupId,
      description: 'ECS Security Group ID',
    });

    new CfnOutput(this, 'RedisEndpoint', {
      value: 'redis.ws.local',
      description: 'Redis service discovery endpoint',
    });
  }
}
