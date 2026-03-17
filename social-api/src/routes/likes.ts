import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddb);
const LIKES_TABLE = 'social-likes';
const PROFILES_TABLE = 'social-profiles';
const POSTS_TABLE = 'social-posts';
const COMMENTS_TABLE = 'social-comments';
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';

// postLikesRouter is mounted at /rooms/:roomId/posts/:postId — mergeParams:true exposes :roomId and :postId
export const postLikesRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/likes — like a post (REAC-01)
postLikesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const userId = req.user!.sub;

    // Membership gate — caller must be a member of the room
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to like a post' });
      return;
    }

    // Post existence check
    const postResult = await docClient.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
    }));
    if (!postResult.Item) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const targetId = `post:${postId}`;
    const createdAt = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: LIKES_TABLE,
      Item: { targetId, userId, type: 'like', createdAt },
      ConditionExpression: 'attribute_not_exists(#uid)',
      ExpressionAttributeNames: { '#uid': 'userId' },
    }));

    // Broadcast social:like to room channel (non-fatal if Redis unavailable)
    const roomForBroadcast = await docClient.send(new GetCommand({
      TableName: ROOMS_TABLE,
      Key: { roomId },
    }));
    if (roomForBroadcast.Item) {
      void broadcastService.emit(roomForBroadcast.Item['channelId'] as string, 'social:like', {
        targetId, userId, type: 'like', createdAt,
      });
    }

    res.status(201).json({ targetId, userId, type: 'like', createdAt });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      res.status(409).json({ error: 'Already liked' });
      return;
    }
    console.error('[likes] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/posts/:postId/likes — unlike a post (REAC-02)
postLikesRouter.delete('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const userId = req.user!.sub;

    // Membership gate
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to unlike a post' });
      return;
    }

    const targetId = `post:${postId}`;

    // Verify like exists before deleting
    const likeResult = await docClient.send(new GetCommand({
      TableName: LIKES_TABLE,
      Key: { targetId, userId },
    }));
    if (!likeResult.Item) {
      res.status(404).json({ error: 'Like not found' });
      return;
    }

    await docClient.send(new DeleteCommand({
      TableName: LIKES_TABLE,
      Key: { targetId, userId },
    }));

    res.status(204).send();
  } catch (err) {
    console.error('[likes] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms/:roomId/posts/:postId/likes — who liked a post with display names and count (REAC-06)
postLikesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const callerId = req.user!.sub;

    // Membership gate
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId: callerId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to view likes' });
      return;
    }

    // Post existence check
    const postResult = await docClient.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
    }));
    if (!postResult.Item) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const targetId = `post:${postId}`;

    // Query all likes for this post
    const queryResult = await docClient.send(new QueryCommand({
      TableName: LIKES_TABLE,
      KeyConditionExpression: 'targetId = :tid',
      FilterExpression: '#t = :like',
      ExpressionAttributeNames: { '#t': 'type' },
      ExpressionAttributeValues: { ':tid': targetId, ':like': 'like' },
    }));

    const userIds = (queryResult.Items ?? []).map((item) => item['userId'] as string);

    // Enrich with display names via BatchGetCommand
    let likedBy: { userId: string; displayName: string }[] = [];
    if (userIds.length > 0) {
      const batchResult = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [PROFILES_TABLE]: {
            Keys: userIds.map((uid) => ({ userId: uid })),
          },
        },
      }));

      const profileItems = batchResult.Responses?.[PROFILES_TABLE] ?? [];
      const profileMap = new Map<string, string>();
      for (const profile of profileItems) {
        profileMap.set(
          profile['userId'] as string,
          (profile['displayName'] as string | undefined) ?? (profile['userId'] as string),
        );
      }

      likedBy = userIds.map((uid) => ({
        userId: uid,
        displayName: profileMap.get(uid) ?? uid,
      }));
    }

    res.status(200).json({ count: userIds.length, likedBy });
  } catch (err) {
    console.error('[likes] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// commentLikesRouter is mounted at /rooms/:roomId/posts/:postId/comments/:commentId — mergeParams:true exposes all params
export const commentLikesRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/comments/:commentId/likes — like a comment (REAC-03)
commentLikesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId, commentId } = req.params;
    const userId = req.user!.sub;

    // Membership gate
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to like a comment' });
      return;
    }

    // Comment existence check
    const commentResult = await docClient.send(new GetCommand({
      TableName: COMMENTS_TABLE,
      Key: { postId, commentId },
    }));
    if (!commentResult.Item) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    const targetId = `comment:${commentId}`;
    const createdAt = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: LIKES_TABLE,
      Item: { targetId, userId, type: 'like', createdAt },
      ConditionExpression: 'attribute_not_exists(#uid)',
      ExpressionAttributeNames: { '#uid': 'userId' },
    }));

    // Broadcast social:like (comment like) to room channel (non-fatal if Redis unavailable)
    const roomForBroadcast = await docClient.send(new GetCommand({
      TableName: ROOMS_TABLE,
      Key: { roomId },
    }));
    if (roomForBroadcast.Item) {
      void broadcastService.emit(roomForBroadcast.Item['channelId'] as string, 'social:like', {
        targetId, userId, type: 'like', createdAt,
      });
    }

    res.status(201).json({ targetId, userId, type: 'like', createdAt });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      res.status(409).json({ error: 'Already liked' });
      return;
    }
    console.error('[likes] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/posts/:postId/comments/:commentId/likes — unlike a comment (REAC-04)
commentLikesRouter.delete('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId, commentId } = req.params;
    const userId = req.user!.sub;

    // Membership gate
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to unlike a comment' });
      return;
    }

    const targetId = `comment:${commentId}`;

    // Verify like exists before deleting
    const likeResult = await docClient.send(new GetCommand({
      TableName: LIKES_TABLE,
      Key: { targetId, userId },
    }));
    if (!likeResult.Item) {
      res.status(404).json({ error: 'Like not found' });
      return;
    }

    await docClient.send(new DeleteCommand({
      TableName: LIKES_TABLE,
      Key: { targetId, userId },
    }));

    res.status(204).send();
  } catch (err) {
    console.error('[likes] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
