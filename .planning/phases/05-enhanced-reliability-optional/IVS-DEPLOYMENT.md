# IVS Chat Deployment Guide

This guide covers enabling the optional AWS IVS Chat feature for persistent chat with content moderation.

## Overview

**What IVS Chat Provides:**
- **Persistent chat history**: Messages stored in AWS managed backend (not ephemeral LRU cache)
- **Content moderation**: Lambda-based profanity filtering before message delivery
- **Delivery guarantees**: AWS IVS handles message durability and delivery
- **Client SDK support**: Direct IVS integration via AWS SDK for browser/mobile clients

**What In-Memory Chat Provides (Default):**
- **Zero cost**: No AWS service charges beyond the gateway itself
- **Low latency**: Direct Redis pub/sub without IVS API overhead
- **Ephemeral messages**: 100 messages per channel in LRU cache (configurable)
- **Simple deployment**: No additional AWS infrastructure required

**When to Use IVS Chat:**
- Chat history must persist beyond active sessions
- Content moderation is legally/operationally required
- Budget supports ~$15.20 per 1M messages (see Cost Estimate section)

**When to Use In-Memory Chat (Default):**
- Chat is purely ephemeral collaboration data
- Message history only needed for current active users
- Cost optimization is priority
- <1M messages/month expected volume

## Prerequisites

Before deploying IVS Chat stack:

1. **AWS Account**: Active AWS account with admin permissions
2. **CDK Bootstrap**: Account/region must be CDK bootstrapped
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```
3. **Redis Endpoint**: ElastiCache Redis cluster deployed (from WebSocketGatewayStack)
4. **VPC Access**: Lambda must reach Redis endpoint on port 6379
5. **Environment Variables**: Set before CDK deploy:
   ```bash
   export REDIS_ENDPOINT="your-redis-cluster.cache.amazonaws.com"
   export REDIS_PORT="6379"
   export AWS_REGION="us-east-1"  # Match your deployment region
   ```

## Deployment Steps

### Step 1: Verify CDK Bootstrap

Ensure your AWS account and region are CDK bootstrapped:

```bash
cdk bootstrap
```

Expected output: `✅ Environment aws://ACCOUNT-ID/REGION bootstrapped`

### Step 2: Set Environment Variables for Lambda

The Lambda message review handler requires Redis connection details to publish approved messages:

```bash
export REDIS_ENDPOINT="your-elasticache-endpoint.cache.amazonaws.com"
export REDIS_PORT="6379"
```

**Note**: These variables are baked into the Lambda function during `cdk deploy`. Changes require redeployment.

### Step 3: Deploy IVS Chat Stack

Deploy the IVS Chat infrastructure stack:

```bash
cdk deploy IvsChatStack
```

This creates:
- IVS Chat room (with 10 msg/sec rate limit, 1000 char max message length)
- Lambda message review handler (Node.js 20.x runtime, 5-second timeout)
- IAM permissions (Lambda invoke from IVS, VPC network interface creation)

**Deployment time**: ~2-3 minutes

### Step 4: Copy IVS_CHAT_ROOM_ARN from Output

After deployment completes, CDK outputs the room ARN:

```
Outputs:
IvsChatStack.IvsChatRoomArn = arn:aws:ivschat:us-east-1:123456789012:room/AbCdEfGhIjKl
```

Copy this ARN value. You'll need it for Step 5.

### Step 5: Update Fargate Task Definition

Add `IVS_CHAT_ROOM_ARN` environment variable to your Fargate task:

**Option A: Via CDK (Recommended)**

Edit `lib/websocket-gateway-stack.ts`:

```typescript
const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
  // ... existing config
});

taskDefinition.addContainer('WebSocketContainer', {
  // ... existing config
  environment: {
    REDIS_ENDPOINT: redisCluster.attrRedisEndpointAddress,
    REDIS_PORT: redisCluster.attrRedisEndpointPort,
    IVS_CHAT_ROOM_ARN: 'arn:aws:ivschat:us-east-1:123456789012:room/AbCdEfGhIjKl', // From Step 4
  }
});
```

**Option B: Via AWS Console**

1. Navigate to ECS > Task Definitions
2. Create new revision of `WebSocketGatewayTaskDef`
3. Add environment variable: `IVS_CHAT_ROOM_ARN` = `<ARN from Step 4>`
4. Update ECS service to use new task definition revision

### Step 6: Redeploy ECS Service

Redeploy the WebSocket Gateway stack to apply the new environment variable:

```bash
cdk deploy WebSocketGatewayStack --force
```

**Note**: `--force` ensures ECS service updates even if CDK detects no logical changes.

### Step 7: Verify Feature Enabled

Check application logs for IVS Chat initialization:

```bash
aws logs tail /aws/ecs/websocket-gateway --follow
```

Expected log entry:
```
[INFO] IVS Chat enabled with room ARN: arn:aws:ivschat:us-east-1:123456789012:room/AbCdEfGhIjKl
```

If you see `[INFO] IVS Chat not configured, feature disabled`, the `IVS_CHAT_ROOM_ARN` environment variable was not set correctly. Return to Step 5.

## Lambda VPC Configuration

The Lambda message review handler **must** access Redis to publish approved messages to pub/sub channels. This requires VPC configuration.

### Reference Existing VPC from WebSocketGatewayStack

If your WebSocketGatewayStack exports the VPC, reference it in IvsChatStack:

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

// In IvsChatStack constructor
const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
  vpcId: 'vpc-12345678' // Replace with your VPC ID
});
```

### Add Lambda to Private Subnets

Configure Lambda to run inside the same VPC as Redis:

```typescript
const reviewHandler = new lambda.Function(this, 'MessageReviewHandler', {
  // ... existing config
  vpc: vpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
  }
});
```

### Security Group Configuration

Ensure Lambda security group can reach Redis on port 6379:

```typescript
const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSG', {
  vpc,
  description: 'Security group for IVS Chat Lambda',
  allowAllOutbound: true
});

// Allow Lambda to reach Redis
redisSg.addIngressRule(
  lambdaSg,
  ec2.Port.tcp(6379),
  'Allow Lambda message review handler to publish to Redis'
);

const reviewHandler = new lambda.Function(this, 'MessageReviewHandler', {
  // ... existing config
  securityGroups: [lambdaSg]
});
```

**Note**: Without VPC access, Lambda cannot publish approved messages to Redis, and messages will not be delivered to WebSocket clients (even if IVS approves them).

## Testing

### Manual Verification Steps

1. **Connect WebSocket client**:
   ```javascript
   const ws = new WebSocket('wss://your-nlb-endpoint.amazonaws.com');
   ```

2. **Request IVS Chat token**:
   ```javascript
   ws.send(JSON.stringify({
     service: 'ivs-chat',
     action: 'token',
     channel: 'test-channel'
   }));
   ```

3. **Receive token response**:
   ```json
   {
     "type": "ivs-chat",
     "action": "token",
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "tokenExpirationTime": "2026-03-03T16:30:00Z"
   }
   ```

4. **Send message via IVS SDK** (browser example):
   ```javascript
   import { ChatRoom } from 'amazon-ivs-chat-messaging';

   const chatRoom = new ChatRoom({
     regionOrUrl: 'us-east-1',
     tokenProvider: () => Promise.resolve(receivedToken)
   });

   await chatRoom.connect();
   await chatRoom.sendMessage('Hello, IVS Chat!');
   ```

5. **Verify message delivery**: WebSocket client should receive message via pub/sub:
   ```json
   {
     "type": "chat",
     "channel": "test-channel",
     "message": "Hello, IVS Chat!",
     "clientId": "...",
     "timestamp": "2026-03-03T15:30:00Z"
   }
   ```

6. **Test profanity filtering**: Send a message containing banned keywords (e.g., "fuck", "shit"). Lambda should deny the message, and it should NOT appear via WebSocket delivery.

### Expected Behavior

- **Clean messages**: Delivered to WebSocket clients via Redis pub/sub
- **Profanity messages**: Denied by Lambda, no WebSocket delivery
- **Lambda errors**: Messages allowed (fail-open), delivered to WebSocket clients
- **Token expiration**: After 60 minutes, client must request new token

## Troubleshooting

### "IVS Chat not configured" Error

**Symptom**: WebSocket client receives error response when requesting token.

**Cause**: `IVS_CHAT_ROOM_ARN` environment variable not set in Fargate task.

**Fix**:
1. Verify environment variable in ECS task definition
2. Redeploy ECS service: `cdk deploy WebSocketGatewayStack --force`
3. Check logs for "IVS Chat enabled" message

### Lambda Timeout (5 seconds)

**Symptom**: Messages not delivered to WebSocket clients. Lambda logs show timeout errors.

**Cause**: Lambda cannot reach Redis endpoint due to VPC/security group misconfiguration.

**Fix**:
1. Verify Lambda is in same VPC as Redis
2. Verify Lambda security group allows outbound traffic
3. Verify Redis security group allows inbound traffic on port 6379 from Lambda security group
4. Test Lambda VPC connectivity: Add test invocation that attempts Redis connection

### Messages Not Delivered to WebSocket Clients

**Symptom**: IVS accepts message (no error), but WebSocket clients don't receive it.

**Cause**: Lambda published to wrong Redis channel, or Redis pub/sub not working.

**Fix**:
1. Check Lambda logs for "Published message to Redis channel: chat:test-channel"
2. Verify Redis endpoint/port environment variables match ElastiCache cluster
3. Test Redis pub/sub manually: `redis-cli SUBSCRIBE chat:test-channel`

### High Lambda Cold Start Latency

**Symptom**: First message in a channel takes 5-10 seconds to deliver.

**Cause**: Lambda cold start with VPC ENI attachment.

**Mitigation**:
- Enable Lambda SnapStart (not yet supported for Node.js 20.x)
- Use provisioned concurrency (adds ~$12/month cost)
- Accept cold start latency as tradeoff for low per-message cost

### IVS Rate Limit Exceeded

**Symptom**: Error response "ThrottlingException: Rate exceeded"

**Cause**: Exceeded 10 messages/second per room limit (configured in CDK).

**Fix**:
1. Increase `maximumMessageRatePerSecond` in `lib/ivs-chat-stack.ts`
2. Redeploy: `cdk deploy IvsChatStack`
3. Note: Higher rate limits may increase costs

## Cost Estimate

**IVS Chat Pricing (us-east-1, as of March 2026):**
- Messages: $1.00 per 1M messages
- Connection minutes: $0.014 per 1000 connection-minutes

**Lambda Pricing:**
- Invocations: $0.20 per 1M requests
- Duration: $0.0000166667 per GB-second (128 MB = 0.125 GB)
- Average execution: ~200ms per message review

**Example: 1M messages/month**
- IVS messages: $1.00
- Lambda invocations: $0.20
- Lambda duration: 1M × 0.2s × 0.125 GB × $0.0000166667 = $0.42
- **Total: ~$1.62/month**

**Example: 10M messages/month (high traffic)**
- IVS messages: $10.00
- Lambda invocations: $2.00
- Lambda duration: $4.17
- **Total: ~$16.17/month**

**In-Memory Chat (Default):**
- Messages: $0 (uses existing Redis pub/sub, no per-message costs)
- Storage: $0 (LRU cache in Fargate memory, no external storage)

**Recommendation**: For <1M messages/month, IVS Chat costs are negligible. For >10M messages/month, evaluate whether persistent chat history justifies the cost vs ephemeral in-memory chat.

## Disabling IVS Chat

To disable IVS Chat and revert to in-memory chat:

1. **Remove environment variable** from Fargate task definition:
   - Edit `lib/websocket-gateway-stack.ts`
   - Remove `IVS_CHAT_ROOM_ARN` from `environment` config
   - Or remove via AWS Console (ECS > Task Definitions)

2. **Redeploy ECS service**:
   ```bash
   cdk deploy WebSocketGatewayStack --force
   ```

3. **Verify feature disabled** in logs:
   ```
   [INFO] IVS Chat not configured, feature disabled
   ```

4. **Optional: Destroy IVS Chat stack** to stop incurring costs:
   ```bash
   cdk destroy IvsChatStack
   ```

**Note**: Destroying the stack deletes the IVS Chat room and all message history. Export data via `aws ivschat list-messages` if you need to preserve chat history before destroying.

## Migration from In-Memory Chat

If you have existing chat data in the in-memory LRU cache and want to preserve it when enabling IVS Chat, see:

**scripts/migrate-chat-to-ivs.js** - One-time migration script for exporting LRU cache to IVS

This is **optional** and only relevant for deployments with active users who have existing chat history worth preserving.
