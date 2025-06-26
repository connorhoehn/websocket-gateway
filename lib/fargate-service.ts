import {
  FargateService,
  Cluster,
  FargateTaskDefinition,
} from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import {
  NetworkLoadBalancer,
  NetworkTargetGroup,
  Protocol,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Vpc, SecurityGroup, Port, Peer, SubnetType } from 'aws-cdk-lib/aws-ec2';

interface FargateServiceProps {
  vpc: Vpc;
  cluster: Cluster;
  taskDef: FargateTaskDefinition;
  redisSecurityGroup?: SecurityGroup;
}

interface FargateServiceResult {
  nlb: NetworkLoadBalancer;
  service: FargateService;
  securityGroup: SecurityGroup;
}

export function createFargateService(
  scope: Construct,
  props: FargateServiceProps
): FargateServiceResult {
  // Create security group for the ECS service
  const ecsSecurityGroup = new SecurityGroup(scope, 'ECSSecurityGroup', {
    vpc: props.vpc,
    description: 'Security group for ECS Fargate service',
    allowAllOutbound: true,
  });

  // Allow inbound traffic on port 8080 from anywhere (NLB will forward traffic)
  ecsSecurityGroup.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(8080),
    'Allow traffic from NLB to ECS tasks'
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
    desiredCount: 0,
    assignPublicIp: false, // Tasks run in isolated private subnets
    vpcSubnets: {
      subnetType: SubnetType.PRIVATE_ISOLATED, // Use isolated subnets
    },
    securityGroups: [ecsSecurityGroup],
  });

  const nlb = new NetworkLoadBalancer(scope, 'WebSocketNLB', {
    vpc: props.vpc,
    internetFacing: true,
    vpcSubnets: {
      subnetType: SubnetType.PUBLIC, // NLB in public subnets
    },
  });

  const listener = nlb.addListener('Listener', { port: 80 });

  listener.addTargets('ECS', {
    port: 8080,
    targets: [service],
  });

  return {
    nlb,
    service,
    securityGroup: ecsSecurityGroup,
  };
}