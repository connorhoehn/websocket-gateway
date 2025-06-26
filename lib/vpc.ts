import { Vpc, SubnetType, GatewayVpcEndpoint, GatewayVpcEndpointAwsService, InterfaceVpcEndpoint, InterfaceVpcEndpointAwsService } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export function createVpc(scope: Construct): Vpc {
  const vpc = new Vpc(scope, 'GatewayVpc', {
    maxAzs: 2,
    natGateways: 0, // No NAT gateway needed
    subnetConfiguration: [
      {
        // Public subnets for NLB
        cidrMask: 24,
        name: 'Public',
        subnetType: SubnetType.PUBLIC,
      },
      {
        // Isolated private subnets for ECS tasks and Redis
        cidrMask: 24,
        name: 'Isolated',
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    ],
  });

  // Add S3 Gateway VPC Endpoint for ECR image layers
  vpc.addGatewayEndpoint('S3GatewayEndpoint', {
    service: GatewayVpcEndpointAwsService.S3,
    subnets: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
  });

  // Add ECR API VPC Endpoint for Docker registry API calls
  vpc.addInterfaceEndpoint('EcrApiEndpoint', {
    service: InterfaceVpcEndpointAwsService.ECR,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
  });

  // Add ECR DKR VPC Endpoint for Docker image pulls
  vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
    service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
  });

  // Add CloudWatch Logs VPC Endpoint for container logging
  vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
    service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
  });

  return vpc;
}