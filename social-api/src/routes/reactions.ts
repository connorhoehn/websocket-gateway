import {
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient } from '../lib/aws-clients';
import { broadcastToRoom } from '../services/room-broadcaster';
import { publishWithOutbox } from '../services/outbox-publisher';
import { requireRoomMembership } from '../middleware/require-membership';
import {
  asyncHandler,
  ValidationError,
  NotFoundError,
} from '../middleware/error-handler';
const LIKES_TABLE = 'social-likes';
const POSTS_TABLE = 'social-posts';

const VALID_EMOJI = new Set(['❤️', '😂', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '⚡', '💯', '🚀']);

// reactionsRouter is mounted at /rooms/:roomId/posts/:postId — mergeParams:true exposes :roomId and :postId
export const reactionsRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/reactions — add an emoji reaction to a post (REAC-05)
// Body: { emoji: string }
reactionsRouter.post('/reactions', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { roomId, postId } = req.params;
  const { emoji } = req.body as { emoji?: string };
  const userId = req.user!.sub;

  // Validate emoji
  if (!emoji || !VALID_EMOJI.has(emoji)) {
    throw new ValidationError('Invalid emoji. Must be one of the 12 supported types');
  }

  // Post existence check
  const postResult = await docClient.send(new GetCommand({
    TableName: POSTS_TABLE,
    Key: { roomId, postId },
  }));
  if (!postResult.Item) {
    throw new NotFoundError('Post not found');
  }

  const targetId = `post:${postId}:reaction`;
  const createdAt = new Date().toISOString();

  await publishWithOutbox({
    target: {
      TableName: LIKES_TABLE,
      Item: { targetId, userId, type: 'reaction', emoji, createdAt },
      ConditionExpression: 'attribute_not_exists(#uid)',
      ExpressionAttributeNames: { '#uid': 'userId' },
    },
    eventType: 'social.reaction',
    queueName: 'social-reactions',
    eventPayload: { targetId, userId, roomId, postId, emoji },
    conflictMessage: 'Already reacted. Delete your existing reaction first.',
  });

  // Broadcast social:like (reaction) to room channel (non-fatal if Redis unavailable)
  await broadcastToRoom(roomId, 'social:like', {
    targetId, userId, type: 'reaction', emoji, createdAt,
  });

  res.status(201).json({ targetId, userId, type: 'reaction', emoji, createdAt });
  // No publishSocialEvent — outbox record handles delivery
}));

// DELETE /api/rooms/:roomId/posts/:postId/reactions/:emoji — remove an emoji reaction from a post (REAC-05)
reactionsRouter.delete('/reactions/:emoji', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { postId } = req.params;
  const emoji = decodeURIComponent(req.params.emoji);
  const userId = req.user!.sub;

  // Validate emoji
  if (!VALID_EMOJI.has(emoji)) {
    throw new ValidationError('Invalid emoji');
  }

  const targetId = `post:${postId}:reaction`;

  // Verify reaction exists before deleting
  const reactionResult = await docClient.send(new GetCommand({
    TableName: LIKES_TABLE,
    Key: { targetId, userId },
  }));
  if (!reactionResult.Item) {
    throw new NotFoundError('Reaction not found');
  }

  await docClient.send(new DeleteCommand({
    TableName: LIKES_TABLE,
    Key: { targetId, userId },
  }));

  res.status(204).send();
}));
