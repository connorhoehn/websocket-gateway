import * as cdk from 'aws-cdk-lib';
import * as ivschat from 'aws-cdk-lib/aws-ivschat';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * IVS Chat Stack - CDK infrastructure for AWS IVS Chat integration
 *
 * Creates:
 * - IVS Chat room for persistent chat with moderation
 * - Lambda message review handler for content filtering
 * - IAM permissions for Lambda to invoke and publish to Redis
 *
 * Lambda handler:
 * - Receives every chat message before delivery
 * - Approves/denies based on profanity check
 * - Publishes approved messages to Redis pub/sub for WebSocket delivery
 * - Fails open (ALLOW) if Lambda errors occur
 *
 * Optional deployment:
 * - Deploy this stack only if persistent chat with moderation is required
 * - Without this stack, system uses in-memory ChatService
 */
export class IvsChatStack extends cdk.Stack {
  public readonly roomArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create message review Lambda
    const reviewHandler = new lambda.Function(this, 'MessageReviewHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'message-review-handler.handler',
      code: lambda.Code.fromAsset('src/lambda'),
      timeout: cdk.Duration.seconds(5),
      environment: {
        REDIS_ENDPOINT: process.env.REDIS_ENDPOINT || '',
        REDIS_PORT: process.env.REDIS_PORT || '6379'
      }
    });

    // Grant Lambda permission to create network interfaces (VPC access for Redis)
    reviewHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:CreateNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DeleteNetworkInterface'],
      resources: ['*']
    }));

    // Create IVS Chat room
    const chatRoom = new ivschat.CfnRoom(this, 'ChatRoom', {
      name: 'websocket-gateway-chat',
      maximumMessageRatePerSecond: 10,
      maximumMessageLength: 1000,
      messageReviewHandler: {
        uri: reviewHandler.functionArn,
        fallbackResult: 'ALLOW' // Allow messages if Lambda fails (fail-open)
      },
      tags: [{
        key: 'Environment',
        value: process.env.NODE_ENV || 'development'
      }]
    });

    // Grant IVS permission to invoke Lambda
    reviewHandler.addPermission('IvsChatInvoke', {
      principal: new iam.ServicePrincipal('ivschat.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: chatRoom.attrArn
    });

    this.roomArn = chatRoom.attrArn;

    new cdk.CfnOutput(this, 'IvsChatRoomArn', {
      value: this.roomArn,
      description: 'IVS Chat Room ARN (set as IVS_CHAT_ROOM_ARN environment variable)'
    });
  }
}
