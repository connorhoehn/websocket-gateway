import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createVpc } from './vpc';
import { createCluster } from './cluster';
import { createTaskDefinition } from './task-definition';
import { createFargateService } from './fargate-service';
import { createRedis } from './redis';

export class WebsocketGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = createVpc(this);
    const cluster = createCluster(this, vpc);
    
    // Check if Redis should be enabled via environment variable
    const enableRedis = process.env.ENABLE_REDIS === 'true';
    let redis: any = null;
    
    if (enableRedis) {
      redis = createRedis(this, vpc);
    }
    
    // Create task definition without Redis connection details
    const taskDef = createTaskDefinition(this);
    
    // Create Fargate service with optional Redis security group
    const fargateResources = createFargateService(this, {
      vpc,
      cluster,
      taskDef,
      redisSecurityGroup: redis?.securityGroup,
    });

    // Output WebSocket URL
    new CfnOutput(this, 'WebSocketURL', {
      value: `ws://${fargateResources.nlb.loadBalancerDnsName}`,
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
      value: fargateResources.nlb.loadBalancerArn,
      description: 'Network Load Balancer ARN',
    });

    new CfnOutput(this, 'SecurityGroupId', {
      value: fargateResources.securityGroup.securityGroupId,
      description: 'ECS Security Group ID',
    });

    // Only output Redis endpoint if Redis is enabled
    if (redis) {
      new CfnOutput(this, 'RedisEndpoint', {
        value: redis.endpoint,
        description: 'Redis cluster endpoint',
      });
    }
  }
}