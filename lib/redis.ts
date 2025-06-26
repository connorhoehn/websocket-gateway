import { CfnReplicationGroup, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache';
import { SubnetType, Vpc, SecurityGroup, Port } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface RedisClusterResult {
  replicationGroup: CfnReplicationGroup;
  securityGroup: SecurityGroup;
  endpoint: string;
  port: number;
}

export function createRedis(scope: Construct, vpc: Vpc): RedisClusterResult {
  // Create security group for Redis
  const redisSecurityGroup = new SecurityGroup(scope, 'RedisSecurityGroup', {
    vpc,
    description: 'Security group for Redis cluster',
    allowAllOutbound: false,
  });

  // Create subnet group for Redis using isolated subnets
  const subnetGroup = new CfnSubnetGroup(scope, 'RedisSubnetGroup', {
    description: 'Subnet group for Redis cluster',
    subnetIds: vpc.isolatedSubnets.map(subnet => subnet.subnetId),
  });

  // Create Redis replication group  
  const replicationGroup = new CfnReplicationGroup(scope, 'RedisCluster', {
    replicationGroupId: 'websocket-redis',
    replicationGroupDescription: 'Redis for WebSocket pub/sub',
    cacheNodeType: 'cache.t3.micro',
    engine: 'redis',
    numNodeGroups: 1,
    replicasPerNodeGroup: 1,
    automaticFailoverEnabled: true,
    cacheSubnetGroupName: subnetGroup.ref,
    securityGroupIds: [redisSecurityGroup.securityGroupId],
  });

  replicationGroup.addDependency(subnetGroup);

  return {
    replicationGroup,
    securityGroup: redisSecurityGroup,
    // Use primary endpoint for standard replication group (non-cluster mode)
    endpoint: replicationGroup.attrPrimaryEndPointAddress,
    port: 6379,
  };
}