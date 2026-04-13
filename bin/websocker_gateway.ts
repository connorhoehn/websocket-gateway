#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SharedInfraStack } from '../lib/shared-infra-stack';
import { WebsocketGatewayStack } from '../lib/websocket-gateway-stack';
import { EksGatewayStack } from '../lib/eks-gateway-stack';
import { SocialStack } from '../lib/social-stack';
import { EventBusStack } from '../lib/event-bus-stack';

const app = new cdk.App();

// Deploy target: 'ecs' (default), 'eks', or 'both'
const deployTarget = app.node.tryGetContext('deployTarget') || 'ecs';

// Shared infrastructure (VPC, Cognito, DynamoDB, CloudMap) — always created
const sharedInfra = new SharedInfraStack(app, 'SharedInfraStack');

// ECS deployment (default)
if (deployTarget === 'ecs' || deployTarget === 'both') {
  new WebsocketGatewayStack(app, 'WebsockerGatewayStack', { sharedInfra });
}

// EKS deployment (optional)
if (deployTarget === 'eks' || deployTarget === 'both') {
  new EksGatewayStack(app, 'EksGatewayStack', { sharedInfra });
}

// Data and event stacks — always created
new SocialStack(app, 'social-stack');
new EventBusStack(app, 'EventBusStack');
