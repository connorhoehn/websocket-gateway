import { ContainerImage, FargateTaskDefinition, LogDriver } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface TaskDefinitionProps {
  redisEndpoint?: string;
  redisPort?: string;
}

export function createTaskDefinition(scope: Construct, props?: TaskDefinitionProps): FargateTaskDefinition {
  // Create execution role with ECR permissions
  const executionRole = new Role(scope, 'TaskExecutionRole', {
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
    ],
  });

  const taskDef = new FargateTaskDefinition(scope, 'TaskDef', {
    executionRole: executionRole,
    cpu: 256,
    memoryLimitMiB: 512,
  });
  
  const environment: { [key: string]: string } = {};
  
  if (props?.redisEndpoint) {
    environment.REDIS_ENDPOINT = props.redisEndpoint;
  }
  
  if (props?.redisPort) {
    environment.REDIS_PORT = props.redisPort;
  } else {
    environment.REDIS_PORT = '6379'; // Default Redis port
  }

  taskDef.addContainer('WebSocketContainer', {
    image: ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
    memoryLimitMiB: 512,
    cpu: 256,
    portMappings: [{ containerPort: 8080 }],
    environment,
    logging: LogDriver.awsLogs({
      streamPrefix: 'websocket-gateway',
      logRetention: RetentionDays.ONE_WEEK,
    }),
  });
  
  return taskDef;
}