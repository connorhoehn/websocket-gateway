import { Vpc, SubnetType, GatewayVpcEndpointAwsService, InterfaceVpcEndpointAwsService, SecurityGroup, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export function createVpc(scope: Construct): Vpc {
  const vpc = new Vpc(scope, 'GatewayVpc', {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      {
        cidrMask: 24,
        name: 'Public',
        subnetType: SubnetType.PUBLIC,
      },
      {
        cidrMask: 24,
        name: 'Isolated',
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    ],
  });

  // Security group for all interface endpoints — allows inbound HTTPS from
  // anything inside the VPC (ECS tasks, etc.). Without this, endpoints default
  // to the VPC's default SG which blocks traffic from custom ECS security groups.
  const endpointSg = new SecurityGroup(scope, 'VpcEndpointSg', {
    vpc,
    description: 'Allow HTTPS from within the VPC to reach interface endpoints',
    allowAllOutbound: false,
  });
  endpointSg.addIngressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(443));

  // Gateway endpoints (free, no SG needed — route table based)
  vpc.addGatewayEndpoint('S3GatewayEndpoint', {
    service: GatewayVpcEndpointAwsService.S3,
    subnets: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
  });

  vpc.addGatewayEndpoint('DynamoDbGatewayEndpoint', {
    service: GatewayVpcEndpointAwsService.DYNAMODB,
    subnets: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
  });

  // Interface endpoints — all use the shared endpointSg
  vpc.addInterfaceEndpoint('EcrApiEndpoint', {
    service: InterfaceVpcEndpointAwsService.ECR,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [endpointSg],
  });

  vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
    service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [endpointSg],
  });

  vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
    service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [endpointSg],
  });

  vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
    service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [endpointSg],
  });

  return vpc;
}