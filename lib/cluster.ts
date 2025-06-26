import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';

export function createCluster(scope: Construct, vpc: Vpc): Cluster {
  return new Cluster(scope, 'GatewayCluster', { vpc });
}