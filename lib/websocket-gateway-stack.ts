import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createVpc } from './vpc';
import { createCluster } from './cluster';
import { createTaskDefinition } from './task-definition';
import { createFargateService } from './fargate-service';
import { createCrdtSnapshotsTable } from './dynamodb-table';
import { createDashboard } from './dashboard';
import { createAlarmTopic } from './sns';
import { createAlarms } from './alarms';
import { createCognito } from './cognito';

export class WebsocketGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = createVpc(this);
    const cluster = createCluster(this, vpc);
    const cognito = createCognito(this);

    // Create DynamoDB table for CRDT snapshots
    const crdtTable = createCrdtSnapshotsTable(this, vpc);

    // Task definition includes a Redis sidecar — app connects to localhost:6379
    const taskDef = createTaskDefinition(this, {
      dynamodbTableName: crdtTable.tableName,
      cognitoUserPoolId: cognito.userPool.userPoolId,
      cognitoRegion: this.region,
    });

    // Grant task role permissions to access DynamoDB table
    crdtTable.table.grantReadWriteData(taskDef.taskRole);

    const fargateResources = createFargateService(this, {
      vpc,
      cluster,
      taskDef,
    });

    // Create CloudWatch Dashboard
    createDashboard(this, {
      ecsService: fargateResources.service,
      ecsCluster: cluster,
      alb: fargateResources.alb,
    });

    // Create SNS topic for alarms
    const alarmEmail = process.env.ALARM_EMAIL;
    const alarmTopic = createAlarmTopic(this, alarmEmail);

    // Create CloudWatch alarms
    createAlarms(this, fargateResources.service, alarmTopic);

    // Output WebSocket URL (HTTPS for secure WebSocket connections)
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

    // Output all resource ARNs
    new CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new CfnOutput(this, 'ClusterArn', {
      value: cluster.clusterArn,
      description: 'ECS Cluster ARN',
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

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: cognito.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new CfnOutput(this, 'CognitoClientId', {
      value: cognito.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
    });
  }
}