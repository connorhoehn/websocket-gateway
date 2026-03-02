import {
  FargateService,
  Cluster,
  FargateTaskDefinition,
} from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Vpc, SecurityGroup, Port, Peer, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Duration } from 'aws-cdk-lib';

interface FargateServiceProps {
  vpc: Vpc;
  cluster: Cluster;
  taskDef: FargateTaskDefinition;
  redisSecurityGroup?: SecurityGroup;
}

interface FargateServiceResult {
  alb: ApplicationLoadBalancer;
  service: FargateService;
  securityGroup: SecurityGroup;
}

export function createFargateService(
  scope: Construct,
  props: FargateServiceProps
): FargateServiceResult {
  // Create security group for the ALB
  const albSecurityGroup = new SecurityGroup(scope, 'ALBSecurityGroup', {
    vpc: props.vpc,
    description: 'Security group for Application Load Balancer',
    allowAllOutbound: true,
  });

  // Allow inbound HTTP and HTTPS traffic from anywhere
  albSecurityGroup.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(80),
    'Allow HTTP traffic from internet'
  );
  albSecurityGroup.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(443),
    'Allow HTTPS traffic from internet'
  );

  // Create security group for the ECS service
  const ecsSecurityGroup = new SecurityGroup(scope, 'ECSSecurityGroup', {
    vpc: props.vpc,
    description: 'Security group for ECS Fargate service',
    allowAllOutbound: true,
  });

  // Allow inbound traffic on port 8080 from ALB only
  ecsSecurityGroup.addIngressRule(
    albSecurityGroup,
    Port.tcp(8080),
    'Allow traffic from ALB to ECS tasks'
  );

  // Add outbound rules for VPC endpoints (ECR, S3, CloudWatch Logs)
  ecsSecurityGroup.addEgressRule(
    Peer.anyIpv4(),
    Port.tcp(443),
    'Allow HTTPS for VPC endpoints (ECR, CloudWatch)'
  );

  // If Redis security group is provided, allow ECS to connect to Redis
  if (props.redisSecurityGroup) {
    props.redisSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      Port.tcp(6379),
      'Allow ECS to connect to Redis'
    );
    console.log('Redis connectivity enabled');
  } else {
    console.log('Running without Redis - standalone mode');
  }

  const service = new FargateService(scope, 'FargateWebSocketService', {
    cluster: props.cluster,
    taskDefinition: props.taskDef,
    desiredCount: 2, // Always maintain redundancy
    assignPublicIp: false, // Tasks run in isolated private subnets
    vpcSubnets: {
      subnetType: SubnetType.PRIVATE_ISOLATED, // Use isolated subnets
    },
    securityGroups: [ecsSecurityGroup],
  });

  const alb = new ApplicationLoadBalancer(scope, 'WebSocketALB', {
    vpc: props.vpc,
    internetFacing: true,
    idleTimeout: Duration.seconds(300), // 5 minutes for long-lived WebSocket connections
    securityGroup: albSecurityGroup,
    vpcSubnets: {
      subnetType: SubnetType.PUBLIC, // ALB in public subnets
    },
  });

  // Certificate ARN from environment variable
  const certificateArn = process.env.ACM_CERTIFICATE_ARN || '<PLACEHOLDER>';
  const certificate = Certificate.fromCertificateArn(scope, 'Certificate', certificateArn);

  // HTTPS listener with certificate
  const httpsListener = alb.addListener('HttpsListener', {
    port: 443,
    protocol: ApplicationProtocol.HTTPS,
    certificates: [certificate],
  });

  // Add targets to HTTPS listener with sticky sessions and health checks
  httpsListener.addTargets('ECS', {
    port: 8080,
    protocol: ApplicationProtocol.HTTP, // wss:// -> ws:// internally
    targets: [service],
    healthCheck: {
      path: '/health',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    },
    deregistrationDelay: Duration.seconds(30), // Graceful shutdown window
    stickinessCookieDuration: Duration.hours(1), // Enable sticky sessions
  });

  // HTTP listener with redirect to HTTPS
  alb.addListener('HttpListener', {
    port: 80,
    protocol: ApplicationProtocol.HTTP,
    defaultAction: ListenerAction.redirect({
      protocol: ApplicationProtocol.HTTPS,
      port: '443',
      permanent: true,
    }),
  });

  // Configure auto-scaling for ECS service
  const scaling = service.autoScaleTaskCount({
    minCapacity: 2,
    maxCapacity: 4,
  });

  scaling.scaleOnCpuUtilization('CpuScaling', {
    targetUtilizationPercent: 70,
    scaleInCooldown: Duration.seconds(300), // 5 minutes
    scaleOutCooldown: Duration.seconds(60), // 1 minute
  });

  return {
    alb,
    service,
    securityGroup: ecsSecurityGroup,
  };
}