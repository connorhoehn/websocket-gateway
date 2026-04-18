import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient, publishSocialEvent } from '../lib/aws-clients';
import { broadcastToRoom } from '../services/room-broadcaster';
import { profileRepo } from '../repositories';
import { requireRoomMembership } from '../middleware/require-membership';
import {
  asyncHandler,
  NotFoundError,
  ConflictError,
} from '../middleware/error-handler';
const LIKES_TABLE = 'social-likes';
const POSTS_TABLE = 'social-posts';
const COMMENTS_TABLE = 'social-comments';

// postLikesRouter is mounted at /rooms/:roomId/posts/:postId — mergeParams:true exposes :roomId and :postId
export const postLikesRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/likes — like a post (REAC-01)
postLikesRouter.post('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { roomId, postId } = req.params;
  const userId = req.user!.sub;

  // Post existence check
  const postResult = await docClient.send(new GetCommand({
    TableName: POSTS_TABLE,
    Key: { roomId, postId },
  }));
  if (!postResult.Item) {
    throw new NotFoundError('Post not found');
  }

  const targetId = `post:${postId}`;
  const createdAt = new Date().toISOString();

  try {
    await docClient.send(new PutCommand({
      TableName: LIKES_TABLE,
      Item: { targetId, userId, type: 'like', createdAt },
      ConditionExpression: 'attribute_not_exists(#uid)',
      ExpressionAttributeNames: { '#uid': 'userId' },
    }));
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new ConflictError('Already liked');
    }
    throw err;
  }

  // Broadcast social:like to room channel (non-fatal if Redis unavailable)
  await broadcastToRoom(roomId, 'social:like', {
    targetId, userId, type: 'like', createdAt,
  });

  res.status(201).json({ targetId, userId, type: 'like', createdAt });

  // Publish social.like event to EventBridge (log-and-continue)
  void publishSocialEvent('social.like', {
    targetId,
    userId,
    roomId,
    postId,
  });
}));

// DELETE /api/rooms/:roomId/posts/:postId/likes — unlike a post (REAC-02)
postLikesRouter.delete('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { postId } = req.params;
  const userId = req.user!.sub;

  const targetId = `post:${postId}`;

  // Verify like exists before deleting
  const likeResult = await docClient.send(new GetCommand({
    TableName: LIKES_TABLE,
    Key: { targetId, userId },
  }));
  if (!likeResult.Item) {
    throw new NotFoundError('Like not found');
  }

  await docClient.send(new DeleteCommand({
    TableName: LIKES_TABLE,
    Key: { targetId, userId },
  }));

  res.status(204).send();
}));

// GET /api/rooms/:roomId/posts/:postId/likes — who liked a post with display names and count (REAC-06)
postLikesRouter.get('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { roomId, postId } = req.params;

  // Post existence check
  const postResult = await docClient.send(new GetCommand({
    TableName: POSTS_TABLE,
    Key: { roomId, postId },
  }));
  if (!postResult.Item) {
    throw new NotFoundError('Post not found');
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

  // Enrich with display names via ProfileRepository
  let likedBy: { userId: string; displayName: string }[] = [];
  if (userIds.length > 0) {
    const profiles = await profileRepo.batchGetProfiles(userIds);
    const profileMap = new Map<string, string>();
    for (const profile of profiles) {
      profileMap.set(profile.userId, profile.displayName ?? profile.userId);
    }

    likedBy = userIds.map((uid) => ({
      userId: uid,
      displayName: profileMap.get(uid) ?? uid,
    }));
  }

  res.status(200).json({ count: userIds.length, likedBy });
}));

// commentLikesRouter is mounted at /rooms/:roomId/posts/:postId/comments/:commentId — mergeParams:true exposes all params
export const commentLikesRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/comments/:commentId/likes — like a comment (REAC-03)
commentLikesRouter.post('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { roomId, postId, commentId } = req.params;
  const userId = req.user!.sub;

  // Comment existence check
  const commentResult = await docClient.send(new GetCommand({
    TableName: COMMENTS_TABLE,
    Key: { postId, commentId },
  }));
  if (!commentResult.Item) {
    throw new NotFoundError('Comment not found');
  }

  const targetId = `comment:${commentId}`;
  const createdAt = new Date().toISOString();

  try {
    await docClient.send(new PutCommand({
      TableName: LIKES_TABLE,
      Item: { targetId, userId, type: 'like', createdAt },
      ConditionExpression: 'attribute_not_exists(#uid)',
      ExpressionAttributeNames: { '#uid': 'userId' },
    }));
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new ConflictError('Already liked');
    }
    throw err;
  }

  // Broadcast social:like (comment like) to room channel (non-fatal if Redis unavailable)
  await broadcastToRoom(roomId, 'social:like', {
    targetId, userId, type: 'like', createdAt,
  });

  res.status(201).json({ targetId, userId, type: 'like', createdAt });

  // Publish social.like event to EventBridge (log-and-continue)
  void publishSocialEvent('social.like', {
    targetId,
    userId,
    roomId,
    commentId,
  });
}));

// DELETE /api/rooms/:roomId/posts/:postId/comments/:commentId/likes — unlike a comment (REAC-04)
commentLikesRouter.delete('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { commentId } = req.params;
  const userId = req.user!.sub;

  const targetId = `comment:${commentId}`;

  // Verify like exists before deleting
  const likeResult = await docClient.send(new GetCommand({
    TableName: LIKES_TABLE,
    Key: { targetId, userId },
  }));
  if (!likeResult.Item) {
    throw new NotFoundError('Like not found');
  }

  await docClient.send(new DeleteCommand({
    TableName: LIKES_TABLE,
    Key: { targetId, userId },
  }));

  res.status(204).send();
}));
