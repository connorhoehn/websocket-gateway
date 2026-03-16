#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WebsocketGatewayStack } from '../lib/websocket-gateway-stack';
import { SocialStack } from '../lib/social-stack';

const app = new cdk.App();
new WebsocketGatewayStack(app, 'WebsockerGatewayStack', {});
new SocialStack(app, 'social-stack', {});
