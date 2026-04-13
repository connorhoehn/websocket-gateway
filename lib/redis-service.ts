import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import {
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  FargateService,
  LogDriver,
  OperatingSystemFamily,
  Cluster,
} from 'aws-cdk-lib/aws-ecs';
import { SecurityGroup, Vpc, SubnetType, Port } from 'aws-cdk-lib/aws-ec2';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { DnsRecordType, PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';

export interface RedisServiceProps {
  vpc: Vpc;
  cluster: Cluster;
  namespace: PrivateDnsNamespace;
}

export interface RedisServiceResult {
  service: FargateService;
  securityGroup: SecurityGroup;
}

/**
 * Reusable construct that deploys Redis as an ECS Fargate service
 * with CloudMap service discovery (redis.ws.local:6379).
 */
export class RedisService extends Construct {
  public readonly service: FargateService;
  public readonly securityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: RedisServiceProps) {
    super(scope, id);

    const stack = Stack.of(this);

    const executionRole = new Role(this, 'RedisExecutionRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskDef = new FargateTaskDefinition(this, 'RedisTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    taskDef.addContainer('RedisContainer', {
      image: ContainerImage.fromRegistry(`${stack.account}.dkr.ecr.${stack.region}.amazonaws.com/redis:7-alpine`),
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

    this.securityGroup = new SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for shared Redis ECS service',
      allowAllOutbound: true,
    });

    this.service = new FargateService(this, 'RedisFargateService', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      minHealthyPercent: 0, // Single replica — allow 0 during deployment
      maxHealthyPercent: 100,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.securityGroup],
      cloudMapOptions: {
        name: 'redis',
        cloudMapNamespace: props.namespace,
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(10),
      },
    });
  }

  /**
   * Allow inbound traffic from a given security group on port 6379.
   */
  allowFrom(securityGroup: SecurityGroup): void {
    this.securityGroup.addIngressRule(
      securityGroup,
      Port.tcp(6379),
      'Allow inbound from ECS tasks to Redis'
    );
  }
}
