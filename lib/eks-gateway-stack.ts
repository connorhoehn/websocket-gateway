import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Cluster, KubernetesVersion, ServiceAccount } from 'aws-cdk-lib/aws-eks';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31';
import { SharedInfraStack } from './shared-infra-stack';

export interface EksGatewayStackProps extends StackProps {
  sharedInfra: SharedInfraStack;
}

export class EksGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props: EksGatewayStackProps) {
    super(scope, id, props);

    const { vpc, crdtTableName, cognito } = props.sharedInfra;

    // ---- EKS Cluster with Fargate ----
    const eksCluster = new Cluster(this, 'EksCluster', {
      version: KubernetesVersion.V1_31,
      kubectlLayer: new KubectlV31Layer(this, 'KubectlLayer'),
      vpc,
      defaultCapacity: 0, // Fargate only, no managed node groups
      clusterName: 'websocket-gateway-eks',
      vpcSubnets: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
    });

    // Fargate profile for the gateway workload
    eksCluster.addFargateProfile('GatewayProfile', {
      selectors: [
        { namespace: 'default' },
      ],
      subnetSelection: { subnetType: SubnetType.PRIVATE_ISOLATED },
      fargateProfileName: 'websocket-gateway',
    });

    // ---- IRSA: IAM Role for Service Account ----
    // This creates a K8s ServiceAccount bound to an IAM role via OIDC,
    // so pods using this SA get AWS permissions without static credentials.
    const gatewayServiceAccount = new ServiceAccount(this, 'GatewayServiceAccount', {
      cluster: eksCluster,
      name: 'websocket-gateway-sa',
      namespace: 'default',
    });

    // DynamoDB permissions (matching ECS task role from task-definition.ts)
    gatewayServiceAccount.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
      resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${crdtTableName}`],
    }));

    // EventBridge permissions
    gatewayServiceAccount.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    // SQS permissions
    gatewayServiceAccount.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sqs:SendMessage'],
      resources: [`arn:aws:sqs:${this.region}:${this.account}:social-*`],
    }));

    // CloudWatch metrics permissions
    gatewayServiceAccount.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // ---- Deploy Helm chart ----
    const imageUri = process.env.IMAGE_URI ||
      `${this.account}.dkr.ecr.${this.region}.amazonaws.com/websocket-gateway:latest`;

    eksCluster.addHelmChart('WebSocketGateway', {
      chart: 'k8s/helm/websocket-gateway',
      namespace: 'default',
      values: {
        gateway: {
          replicaCount: 2,
          serviceAccountName: gatewayServiceAccount.serviceAccountName,
          image: {
            repository: imageUri.split(':')[0],
            tag: imageUri.split(':')[1] || 'latest',
            pullPolicy: 'Always',
          },
          env: {
            NODE_ENV: 'production',
            LOG_LEVEL: 'info',
            ENABLED_SERVICES: 'chat,presence,cursor,reaction,crdt',
            SKIP_AUTH: 'false',
            COGNITO_USER_POOL_ID: cognito.userPool.userPoolId,
            COGNITO_REGION: this.region,
            DYNAMODB_CRDT_TABLE: crdtTableName,
            AWS_REGION: this.region,
            REDIS_ENDPOINT: 'websocket-gateway-redis',
            REDIS_PORT: '6379',
          },
        },
        redis: {
          enabled: true,
        },
        dynamodb: {
          enabled: false, // Use AWS DynamoDB, not local
        },
        socialApi: {
          enabled: false, // Deploy separately if needed
        },
      },
    });

    // ---- Outputs ----
    new CfnOutput(this, 'EksClusterName', {
      value: eksCluster.clusterName,
      description: 'EKS Cluster name',
    });

    new CfnOutput(this, 'EksClusterArn', {
      value: eksCluster.clusterArn,
      description: 'EKS Cluster ARN',
    });

    new CfnOutput(this, 'EksKubectlRole', {
      value: eksCluster.kubectlRole?.roleArn ?? 'N/A',
      description: 'IAM role ARN for kubectl access',
    });

    new CfnOutput(this, 'EksEndpoint', {
      value: eksCluster.clusterEndpoint,
      description: 'EKS API server endpoint',
    });

    new CfnOutput(this, 'GatewayServiceAccountRoleArn', {
      value: gatewayServiceAccount.role.roleArn,
      description: 'IRSA role ARN for gateway pods',
    });
  }
}
