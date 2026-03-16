import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class SocialStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Social profiles — one per Cognito user
    const profilesTable = new Table(this, 'SocialProfilesTable', {
      tableName: 'social-profiles',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Follow relationships between users
    const relationshipsTable = new Table(this, 'SocialRelationships', {
      tableName: 'social-relationships',
      partitionKey: { name: 'followerId', type: AttributeType.STRING },
      sortKey: { name: 'followeeId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Groups (communities / channels)
    const groupsTable = new Table(this, 'SocialGroupsTable', {
      tableName: 'social-groups',
      partitionKey: { name: 'groupId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Group membership
    const groupMembersTable = new Table(this, 'SocialGroupMembers', {
      tableName: 'social-group-members',
      partitionKey: { name: 'groupId', type: AttributeType.STRING },
      sortKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Rooms (real-time chat rooms mapped to WebSocket channels)
    const roomsTable = new Table(this, 'SocialRoomsTable', {
      tableName: 'social-rooms',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Room membership
    const roomMembersTable = new Table(this, 'SocialRoomMembers', {
      tableName: 'social-room-members',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
      sortKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Posts within rooms
    const postsTable = new Table(this, 'SocialPostsTable', {
      tableName: 'social-posts',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
      sortKey: { name: 'postId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Comments on posts
    const commentsTable = new Table(this, 'SocialCommentsTable', {
      tableName: 'social-comments',
      partitionKey: { name: 'postId', type: AttributeType.STRING },
      sortKey: { name: 'commentId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Likes / reactions on posts or comments
    const likesTable = new Table(this, 'SocialLikesTable', {
      tableName: 'social-likes',
      partitionKey: { name: 'targetId', type: AttributeType.STRING },
      sortKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // CfnOutputs for all table names
    new CfnOutput(this, 'SocialProfilesTableName', { value: profilesTable.tableName });
    new CfnOutput(this, 'SocialRelationshipsName', { value: relationshipsTable.tableName });
    new CfnOutput(this, 'SocialGroupsTableName', { value: groupsTable.tableName });
    new CfnOutput(this, 'SocialGroupMembersName', { value: groupMembersTable.tableName });
    new CfnOutput(this, 'SocialRoomsTableName', { value: roomsTable.tableName });
    new CfnOutput(this, 'SocialRoomMembersName', { value: roomMembersTable.tableName });
    new CfnOutput(this, 'SocialPostsTableName', { value: postsTable.tableName });
    new CfnOutput(this, 'SocialCommentsTableName', { value: commentsTable.tableName });
    new CfnOutput(this, 'SocialLikesTableName', { value: likesTable.tableName });
  }
}
