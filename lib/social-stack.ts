import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class SocialStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Social profiles — one per Cognito user
    const profilesTable = new Table(this, 'SocialProfilesTable', {
      tableName: 'social-profiles',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Follow relationships between users
    const relationshipsTable = new Table(this, 'SocialRelationships', {
      tableName: 'social-relationships',
      partitionKey: { name: 'followerId', type: AttributeType.STRING },
      sortKey: { name: 'followeeId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Reverse-direction lookup: followers of a given user
    relationshipsTable.addGlobalSecondaryIndex({
      indexName: 'followeeId-followerId-index',
      partitionKey: { name: 'followeeId', type: AttributeType.STRING },
      sortKey: { name: 'followerId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // Groups (communities / channels)
    const groupsTable = new Table(this, 'SocialGroupsTable', {
      tableName: 'social-groups',
      partitionKey: { name: 'groupId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Group membership
    const groupMembersTable = new Table(this, 'SocialGroupMembers', {
      tableName: 'social-group-members',
      partitionKey: { name: 'groupId', type: AttributeType.STRING },
      sortKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Rooms (real-time chat rooms mapped to WebSocket channels)
    const roomsTable = new Table(this, 'SocialRoomsTable', {
      tableName: 'social-rooms',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Room membership
    const roomMembersTable = new Table(this, 'SocialRoomMembers', {
      tableName: 'social-room-members',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
      sortKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // "My rooms" lookup: rooms a given user is a member of
    roomMembersTable.addGlobalSecondaryIndex({
      indexName: 'userId-roomId-index',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'roomId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // Posts within rooms
    const postsTable = new Table(this, 'SocialPostsTable', {
      tableName: 'social-posts',
      partitionKey: { name: 'roomId', type: AttributeType.STRING },
      sortKey: { name: 'postId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // User post history: every post authored by a given user, newest first via postId (ULID)
    postsTable.addGlobalSecondaryIndex({
      indexName: 'authorId-postId-index',
      partitionKey: { name: 'authorId', type: AttributeType.STRING },
      sortKey: { name: 'postId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // Comments on posts
    const commentsTable = new Table(this, 'SocialCommentsTable', {
      tableName: 'social-comments',
      partitionKey: { name: 'postId', type: AttributeType.STRING },
      sortKey: { name: 'commentId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Likes / reactions on posts or comments
    const likesTable = new Table(this, 'SocialLikesTable', {
      tableName: 'social-likes',
      partitionKey: { name: 'targetId', type: AttributeType.STRING },
      sortKey: { name: 'userId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Pipeline definitions — per-user pipeline graphs (replaces in-memory stub)
    const pipelineDefinitionsTable = new Table(this, 'PipelineDefinitionsTable', {
      tableName: 'pipeline-definitions',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'pipelineId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Append-only audit log for pipeline operations (trigger, approve,
    // reject, cancel, webhook). Caller-generated ULID `auditId` is the PK.
    const pipelineAuditTable = new Table(this, 'PipelineAuditTable', {
      tableName: 'pipeline-audit',
      partitionKey: { name: 'auditId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Per-actor timeline: every audit event authored by a given user, newest first.
    pipelineAuditTable.addGlobalSecondaryIndex({
      indexName: 'actor-time-index',
      partitionKey: { name: 'actorUserId', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    // Per-pipeline timeline: every audit event for a given pipeline, newest first.
    pipelineAuditTable.addGlobalSecondaryIndex({
      indexName: 'pipeline-time-index',
      partitionKey: { name: 'pipelineId', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
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
    new CfnOutput(this, 'PipelineDefinitionsTableName', { value: pipelineDefinitionsTable.tableName });
    new CfnOutput(this, 'PipelineAuditTableName', { value: pipelineAuditTable.tableName });
  }
}
