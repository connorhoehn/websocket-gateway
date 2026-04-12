import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
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
import {
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  FargateService as EcsFargateService,
  LogDriver,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import { SecurityGroup, Port, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { DnsRecordType, PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';

export class WebsocketGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = createVpc(this);
    const cluster = createCluster(this, vpc);
    const cognito = createCognito(this);

    // Create DynamoDB table for CRDT snapshots
    const crdtTable = createCrdtSnapshotsTable(this, vpc);

    // ---- Shared Redis ECS Service with CloudMap discovery ----

    // CloudMap private DNS namespace for service discovery
    const namespace = new PrivateDnsNamespace(this, 'ServiceNamespace', {
      name: 'ws.local',
      vpc,
    });

    // Redis task definition (standalone service, not a sidecar)
    const redisExecutionRole = new Role(this, 'RedisExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const redisTaskDef = new FargateTaskDefinition(this, 'RedisTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole: redisExecutionRole,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    redisTaskDef.addContainer('RedisContainer', {
      image: ContainerImage.fromRegistry('264161986065.dkr.ecr.us-east-1.amazonaws.com/redis:7-alpine'),
      memoryLimitMiB: 512,
      portMappings: [{ containerPort: 6379 }],
      essential: true,
      healthCheck: {
        command: ['CMD', 'redis-cli', 'ping'],
        interval: Duration.seconds(10),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(10),
      },
      logging: LogDriver.awsLogs({
        streamPrefix: 'redis',
        logRetention: RetentionDays.ONE_WEEK,
      }),
    });

    // Security group for the Redis service
    const redisSecurityGroup = new SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for shared Redis ECS service',
      allowAllOutbound: true,
    });

    // Redis Fargate service with CloudMap registration
    const redisService = new EcsFargateService(this, 'RedisFargateService', {
      cluster,
      taskDefinition: redisTaskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [redisSecurityGroup],
      cloudMapOptions: {
        name: 'redis',
        cloudMapNamespace: namespace,
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(10),
      },
    });

    // ---- WebSocket app task definition (connects to redis.ws.local:6379) ----
    const taskDef = createTaskDefinition(this, {
      dynamodbTableName: crdtTable.tableName,
      cognitoUserPoolId: cognito.userPool.userPoolId,
      cognitoRegion: this.region,
      redisEndpoint: 'redis.ws.local',
    });

    // Grant task role permissions to access DynamoDB table
    crdtTable.table.grantReadWriteData(taskDef.taskRole);

    const fargateResources = createFargateService(this, {
      vpc,
      cluster,
      taskDef,
      redisSecurityGroup,
    });

    // Ensure WebSocket service starts after Redis is registered in Cloud Map
    fargateResources.service.node.addDependency(redisService);

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

    new CfnOutput(this, 'RedisEndpoint', {
      value: 'redis.ws.local',
      description: 'Redis service discovery endpoint',
    });
  }
}
