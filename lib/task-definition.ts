import { ContainerImage, FargateTaskDefinition, LogDriver } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Stack } from 'aws-cdk-lib';

interface TaskDefinitionProps {
  redisEndpoint?: string;
  redisPort?: string;
  dynamodbTableName?: string;
  imageUri?: string;
}

export function createTaskDefinition(scope: Construct, props?: TaskDefinitionProps): FargateTaskDefinition {
  // Create execution role with ECR permissions
  const executionRole = new Role(scope, 'TaskExecutionRole', {
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
    ],
  });

  // Create task role with DynamoDB permissions
  const taskRole = new Role(scope, 'TaskRole', {
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
  });

  // Get stack for region and account
  const stack = Stack.of(scope);

  // Add DynamoDB permissions to task role
  taskRole.addToPolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'dynamodb:PutItem',
      'dynamodb:GetItem',
      'dynamodb:Query'
    ],
    resources: [`arn:aws:dynamodb:${stack.region}:${stack.account}:table/crdt-snapshots`]
  }));

  const taskDef = new FargateTaskDefinition(scope, 'TaskDef', {
    executionRole: executionRole,
    taskRole: taskRole,
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

  if (props?.dynamodbTableName) {
    environment.DYNAMODB_CRDT_TABLE = props.dynamodbTableName;
  }

  const imageUri = props?.imageUri || process.env.IMAGE_URI || '264161986065.dkr.ecr.us-east-1.amazonaws.com/websocket-gateway:latest';

  taskDef.addContainer('WebSocketContainer', {
    image: ContainerImage.fromRegistry(imageUri),
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