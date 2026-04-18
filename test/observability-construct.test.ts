import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as sns from 'aws-cdk-lib/aws-sns';
import { WebSocketGatewayObservability } from '../lib/observability-construct';

/**
 * Builds a minimal test stack with real (lightweight) CDK constructs satisfying
 * the observability construct's type signature: VPC + Cluster + FargateService + ALB.
 *
 * This mirrors the production wiring from websocket-gateway-stack.ts just enough
 * to exercise createAlarms() and createDashboard(). We intentionally do NOT build
 * the full FargateService-with-task-definition machinery; we just need the types.
 */
function buildTestStack(): { stack: cdk.Stack; topic: sns.Topic } {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });

  const vpc = new ec2.Vpc(stack, 'TestVpc', { maxAzs: 2 });
  const cluster = new ecs.Cluster(stack, 'TestCluster', { vpc });

  const taskDef = new ecs.FargateTaskDefinition(stack, 'TestTaskDef', {
    memoryLimitMiB: 512,
    cpu: 256,
  });
  taskDef.addContainer('TestContainer', {
    image: ecs.ContainerImage.fromRegistry('nginx:latest'),
    portMappings: [{ containerPort: 8080 }],
  });

  const service = new ecs.FargateService(stack, 'TestService', {
    cluster,
    taskDefinition: taskDef,
    desiredCount: 1,
  });

  const alb = new elbv2.ApplicationLoadBalancer(stack, 'TestAlb', {
    vpc,
    internetFacing: true,
  });

  const topic = new sns.Topic(stack, 'AlarmTopic', {
    topicName: 'websocket-gateway-alarms',
  });

  new WebSocketGatewayObservability(stack, 'Observability', {
    service,
    cluster,
    alb,
    snsTopic: topic,
  });

  return { stack, topic };
}

describe('WebSocketGatewayObservability', () => {
  test('smoke: construct instantiates and stack synthesizes', () => {
    expect(() => {
      const { stack } = buildTestStack();
      Template.fromStack(stack);
    }).not.toThrow();
  });

  test('creates exactly 3 CloudWatch alarms (memory, connection failure, authz denial)', () => {
    const { stack } = buildTestStack();
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  });

  test('creates exactly 1 CloudWatch dashboard', () => {
    const { stack } = buildTestStack();
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  test('ConnectionFailureAlarm is wired to the SNS alarm topic', () => {
    const { stack } = buildTestStack();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'WebSocketGateway-ConnectionFailures',
      AlarmActions: Match.arrayWith([
        Match.objectLike({ Ref: Match.stringLikeRegexp('^AlarmTopic') }),
      ]),
    });
  });

  test('preserves expected CloudFormation logical IDs (parent-scope instantiation)', () => {
    // The refactor's claim is that instantiating alarms/dashboard on the *parent*
    // scope (not on `this` inside the construct) keeps their logical IDs identical
    // to the pre-refactor layout. If these IDs change, CloudFormation will recreate
    // the resources on next deploy — so this test exists to catch that drift.
    const { stack } = buildTestStack();
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources;

    const expectedLogicalIds = [
      'OperationalDashboard8C0EDB2C',
      'MemoryUtilizationAlarm544270BF',
      'ConnectionFailureAlarmC0589AE6',
      'AuthorizationDenialAlarm6DDA60E3',
    ];

    for (const id of expectedLogicalIds) {
      expect(resources[id]).toBeDefined();
    }
  });
});
