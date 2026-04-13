import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { createVpc } from './vpc';
import { createCluster } from './cluster';
import { createCrdtSnapshotsTable } from './dynamodb-table';
import { createCognito, CognitoResources } from './cognito';

export class SharedInfraStack extends Stack {
  public readonly vpc: Vpc;
  public readonly cluster: Cluster;
  public readonly crdtTable: ITable;
  public readonly crdtTableName: string;
  public readonly cognito: CognitoResources;
  public readonly namespace: PrivateDnsNamespace;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = createVpc(this);
    this.cluster = createCluster(this, this.vpc);
    this.cognito = createCognito(this);

    const crdtResult = createCrdtSnapshotsTable(this, this.vpc);
    this.crdtTable = crdtResult.table;
    this.crdtTableName = crdtResult.tableName;

    this.namespace = new PrivateDnsNamespace(this, 'ServiceNamespace', {
      name: 'ws.local',
      vpc: this.vpc,
    });

    // Outputs
    new CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
    });

    new CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'ECS Cluster ARN',
    });

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: this.cognito.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new CfnOutput(this, 'CognitoClientId', {
      value: this.cognito.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
    });
  }
}
