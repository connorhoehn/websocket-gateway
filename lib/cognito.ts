import { RemovalPolicy } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface CognitoResources {
  userPool: UserPool;
  userPoolClient: UserPoolClient;
}

export function createCognito(scope: Construct): CognitoResources {
  const userPool = new UserPool(scope, 'UserPool', {
    userPoolName: 'websocket-gateway-users',
    selfSignUpEnabled: false,
    signInAliases: { email: true },
    autoVerify: { email: true },
    removalPolicy: RemovalPolicy.RETAIN,
  });

  const userPoolClient = new UserPoolClient(scope, 'UserPoolClient', {
    userPool,
    userPoolClientName: 'wsgateway-server',
    generateSecret: false,
    authFlows: {
      userPassword: true,
      adminUserPassword: true,
      userSrp: true,
    },
  });

  return { userPool, userPoolClient };
}
