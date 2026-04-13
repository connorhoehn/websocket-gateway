import { ContainerImage, CpuArchitecture, FargateTaskDefinition, LogDriver, OperatingSystemFamily } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Stack } from 'aws-cdk-lib';

interface TaskDefinitionProps {
  dynamodbTableName?: string;
  imageUri?: string;
  cognitoUserPoolId?: string;
  cognitoRegion?: string;
  redisEndpoint: string;
}

export function createTaskDefinition(scope: Construct, props: TaskDefinitionProps): FargateTaskDefinition {
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
    resources: [`arn:aws:dynamodb:${stack.region}:${stack.account}:table/${props.dynamodbTableName || 'crdt-snapshots'}`],
  }));

  // EventBridge permissions — allow publishing social events
  taskRole.addToPolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['events:PutEvents'],
    resources: ['*'],
  }));

  // SQS permissions — allow sending to social queues
  taskRole.addToPolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['sqs:SendMessage'],
    resources: [`arn:aws:sqs:${stack.region}:${stack.account}:social-*`],
  }));

  // 512 cpu / 1024 MB — all allocated to the app container (Redis is a separate service)
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

  const environment: { [key: string]: string } = {
    REDIS_ENDPOINT: props.redisEndpoint,
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

  const imageUri = props?.imageUri || process.env.IMAGE_URI || `${stack.account}.dkr.ecr.${stack.region}.amazonaws.com/websocket-gateway:latest`;

  taskDef.addContainer('WebSocketContainer', {
    image: ContainerImage.fromRegistry(imageUri),
    memoryLimitMiB: 1024,
    cpu: 512,
    portMappings: [{ containerPort: 8080 }],
    environment,
    logging: LogDriver.awsLogs({
      streamPrefix: 'websocket-gateway',
      logRetention: RetentionDays.ONE_WEEK,
    }),
  });

  return taskDef;
}
