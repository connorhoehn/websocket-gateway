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
    desiredCount: 2,
    assignPublicIp: false,
    vpcSubnets: {
      subnetType: SubnetType.PRIVATE_ISOLATED,
    },
    securityGroups: [ecsSecurityGroup],
    circuitBreaker: { rollback: true }, // Fail fast instead of looping on crashed tasks
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
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

  const certificateArn = process.env.ACM_CERTIFICATE_ARN;

  if (certificateArn) {
    // HTTPS listener with certificate
    const certificate = Certificate.fromCertificateArn(scope, 'Certificate', certificateArn);
    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [certificate],
    });

    httpsListener.addTargets('ECS', {
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: 'WebSocketContainer', containerPort: 8080 })],
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: Duration.seconds(30),
      stickinessCookieDuration: Duration.hours(1),
    });

    // HTTP redirects to HTTPS when cert is present
    alb.addListener('HttpListener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.redirect({
        protocol: ApplicationProtocol.HTTPS,
        port: '443',
        permanent: true,
      }),
    });
  } else {
    // No cert — HTTP only (dev/testing without a domain)
    console.log('No ACM_CERTIFICATE_ARN set — deploying HTTP-only listener on port 80');
    const httpListener = alb.addListener('HttpListener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
    });

    httpListener.addTargets('ECS', {
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: 'WebSocketContainer', containerPort: 8080 })],
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: Duration.seconds(30),
      stickinessCookieDuration: Duration.hours(1),
    });
  }

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