import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue as SqsQueueTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Alarm, ComparisonOperator, TreatMissingData, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export class EventBusStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ---- EventBridge custom bus ----
    const eventBus = new EventBus(this, 'SocialEventsBus', {
      eventBusName: 'social-events',
    });

    // ---- DLQ sibling queues (retention: 14 days) ----
    const followsDlq = new Queue(this, 'SocialFollowsDlq', {
      queueName: 'social-follows-dlq',
      retentionPeriod: Duration.days(14),
    });

    const roomsDlq = new Queue(this, 'SocialRoomsDlq', {
      queueName: 'social-rooms-dlq',
      retentionPeriod: Duration.days(14),
    });

    const postsDlq = new Queue(this, 'SocialPostsDlq', {
      queueName: 'social-posts-dlq',
      retentionPeriod: Duration.days(14),
    });

    const reactionsDlq = new Queue(this, 'SocialReactionsDlq', {
      queueName: 'social-reactions-dlq',
      retentionPeriod: Duration.days(14),
    });

    // ---- Main SQS queues with DLQ redrive policies ----
    // VisibilityTimeout=60s matches LocalStack bootstrap.sh (production parity).
    const followsQueue = new Queue(this, 'SocialFollowsQueue', {
      queueName: 'social-follows',
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: {
        queue: followsDlq,
        maxReceiveCount: 3,
      },
    });

    const roomsQueue = new Queue(this, 'SocialRoomsQueue', {
      queueName: 'social-rooms',
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: {
        queue: roomsDlq,
        maxReceiveCount: 3,
      },
    });

    const postsQueue = new Queue(this, 'SocialPostsQueue', {
      queueName: 'social-posts',
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: {
        queue: postsDlq,
        maxReceiveCount: 3,
      },
    });

    const reactionsQueue = new Queue(this, 'SocialReactionsQueue', {
      queueName: 'social-reactions',
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: {
        queue: reactionsDlq,
        maxReceiveCount: 3,
      },
    });

    // ---- EventBridge routing rules ----
    // Routes social events by detail-type prefix to the correct typed SQS queue.

    new Rule(this, 'FollowEventsRule', {
      ruleName: 'follow-events',
      eventBus,
      eventPattern: {
        detailType: [{ prefix: 'social.follow' } as unknown as string],
      },
      targets: [new SqsQueueTarget(followsQueue)],
    });

    new Rule(this, 'RoomEventsRule', {
      ruleName: 'room-events',
      eventBus,
      eventPattern: {
        detailType: [{ prefix: 'social.room' } as unknown as string],
      },
      targets: [new SqsQueueTarget(roomsQueue)],
    });

    new Rule(this, 'PostEventsRule', {
      ruleName: 'post-events',
      eventBus,
      eventPattern: {
        detailType: [
          { prefix: 'social.post' } as unknown as string,
          { prefix: 'social.comment' } as unknown as string,
        ],
      },
      targets: [new SqsQueueTarget(postsQueue)],
    });

    new Rule(this, 'ReactionEventsRule', {
      ruleName: 'reaction-events',
      eventBus,
      eventPattern: {
        detailType: [
          { prefix: 'social.reaction' } as unknown as string,
          { prefix: 'social.like' } as unknown as string,
        ],
      },
      targets: [new SqsQueueTarget(reactionsQueue)],
    });

    // ---- CloudWatch alarms for DLQ depth ----
    // Each alarm fires when ApproximateNumberOfMessagesVisible > 0.

    new Alarm(this, 'FollowsDlqDepthAlarm', {
      alarmName: 'social-follows-dlq-depth',
      metric: new Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: followsDlq.queueName },
        period: Duration.seconds(60),
        statistic: 'Sum',
      }),
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.IGNORE,
    });

    new Alarm(this, 'RoomsDlqDepthAlarm', {
      alarmName: 'social-rooms-dlq-depth',
      metric: new Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: roomsDlq.queueName },
        period: Duration.seconds(60),
        statistic: 'Sum',
      }),
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.IGNORE,
    });

    new Alarm(this, 'PostsDlqDepthAlarm', {
      alarmName: 'social-posts-dlq-depth',
      metric: new Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: postsDlq.queueName },
        period: Duration.seconds(60),
        statistic: 'Sum',
      }),
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.IGNORE,
    });

    new Alarm(this, 'ReactionsDlqDepthAlarm', {
      alarmName: 'social-reactions-dlq-depth',
      metric: new Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesVisible',
        dimensionsMap: { QueueName: reactionsDlq.queueName },
        period: Duration.seconds(60),
        statistic: 'Sum',
      }),
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.IGNORE,
    });

    // ---- CfnOutputs ----
    new CfnOutput(this, 'EventBusName', { value: eventBus.eventBusName });

    new CfnOutput(this, 'SocialFollowsQueueUrl', { value: followsQueue.queueUrl });
    new CfnOutput(this, 'SocialRoomsQueueUrl', { value: roomsQueue.queueUrl });
    new CfnOutput(this, 'SocialPostsQueueUrl', { value: postsQueue.queueUrl });
    new CfnOutput(this, 'SocialReactionsQueueUrl', { value: reactionsQueue.queueUrl });

    new CfnOutput(this, 'SocialFollowsDlqUrl', { value: followsDlq.queueUrl });
    new CfnOutput(this, 'SocialRoomsDlqUrl', { value: roomsDlq.queueUrl });
    new CfnOutput(this, 'SocialPostsDlqUrl', { value: postsDlq.queueUrl });
    new CfnOutput(this, 'SocialReactionsDlqUrl', { value: reactionsDlq.queueUrl });
  }
}
