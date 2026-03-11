import { ContainerImage, CpuArchitecture, FargateTaskDefinition, LogDriver, OperatingSystemFamily, ContainerDependencyCondition } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Stack } from 'aws-cdk-lib';

interface TaskDefinitionProps {
  dynamodbTableName?: string;
  imageUri?: string;
  cognitoUserPoolId?: string;
  cognitoRegion?: string;
}

export function createTaskDefinition(scope: Construct, props?: TaskDefinitionProps): FargateTaskDefinition {
  const executionRole = new Role(scope, 'TaskExecutionRole', {
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
    ],
  });

  const taskRole = new Role(scope, 'TaskRole', {
    assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
  });

  const stack = Stack.of(scope);

  taskRole.addToPolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
    resources: [`arn:aws:dynamodb:${stack.region}:${stack.account}:table/crdt-snapshots`],
  }));

  // 512 cpu / 1024 MB — split between Redis sidecar + app container
  const taskDef = new FargateTaskDefinition(scope, 'TaskDef', {
    executionRole,
    taskRole,
    cpu: 512,
    memoryLimitMiB: 1024,
    runtimePlatform: {
      cpuArchitecture: CpuArchitecture.ARM64,
      operatingSystemFamily: OperatingSystemFamily.LINUX,
    },
  });

  // Redis sidecar — app connects to localhost:6379, same as local docker-compose
  const redisContainer = taskDef.addContainer('RedisContainer', {
    image: ContainerImage.fromRegistry('264161986065.dkr.ecr.us-east-1.amazonaws.com/redis:7-alpine'),
    memoryLimitMiB: 128,
    cpu: 128,
    essential: true,
    logging: LogDriver.awsLogs({
      streamPrefix: 'redis',
      logRetention: RetentionDays.ONE_WEEK,
    }),
  });

  const environment: { [key: string]: string } = {
    REDIS_ENDPOINT: 'localhost',
    REDIS_PORT: '6379',
  };

  if (props?.dynamodbTableName) {
    environment.DYNAMODB_CRDT_TABLE = props.dynamodbTableName;
  }

  if (props?.cognitoUserPoolId) {
    environment.COGNITO_USER_POOL_ID = props.cognitoUserPoolId;
  }

  if (props?.cognitoRegion) {
    environment.COGNITO_REGION = props.cognitoRegion;
  }

  const imageUri = props?.imageUri || process.env.IMAGE_URI || '264161986065.dkr.ecr.us-east-1.amazonaws.com/websocket-gateway:latest';

  const appContainer = taskDef.addContainer('WebSocketContainer', {
    image: ContainerImage.fromRegistry(imageUri),
    memoryLimitMiB: 896,
    cpu: 384,
    portMappings: [{ containerPort: 8080 }],
    environment,
    logging: LogDriver.awsLogs({
      streamPrefix: 'websocket-gateway',
      logRetention: RetentionDays.ONE_WEEK,
    }),
  });

  // Wait for Redis to start before launching the app
  appContainer.addContainerDependencies({
    container: redisContainer,
    condition: ContainerDependencyCondition.START,
  });

  return taskDef;
}