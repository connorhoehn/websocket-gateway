import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export function createAlarmTopic(scope: Construct, email?: string): sns.Topic {
  const topic = new sns.Topic(scope, 'AlarmTopic', {
    displayName: 'WebSocket Gateway Alarms',
    topicName: 'websocket-gateway-alarms',
  });

  // Add email subscription if provided
  if (email) {
    topic.addSubscription(new subscriptions.EmailSubscription(email));
  }

  return topic;
}
