import {
  GetCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';
import { docClient } from '../lib/aws-clients';
import { getCachedRoom, setCachedRoom } from '../lib/cache';
import { roomRepo } from '../repositories';
import { requireRoomMembership } from '../middleware/require-membership';
const LIKES_TABLE = 'social-likes';
const POSTS_TABLE = 'social-posts';
const OUTBOX_TABLE = 'social-outbox';

const VALID_EMOJI = new Set(['❤️', '😂', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '⚡', '💯', '🚀']);

// reactionsRouter is mounted at /rooms/:roomId/posts/:postId — mergeParams:true exposes :roomId and :postId
export const reactionsRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/reactions — add an emoji reaction to a post (REAC-05)
// Body: { emoji: string }
reactionsRouter.post('/reactions', requireRoomMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const { emoji } = req.body as { emoji?: string };
    const userId = req.user!.sub;

    // Validate emoji
    if (!emoji || !VALID_EMOJI.has(emoji)) {
      res.status(400).json({ error: 'Invalid emoji. Must be one of the 12 supported types' });
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

    const targetId = `post:${postId}:reaction`;
    const createdAt = new Date().toISOString();
    const outboxId = ulid();

    try {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: LIKES_TABLE,
              Item: { targetId, userId, type: 'reaction', emoji, createdAt },
              ConditionExpression: 'attribute_not_exists(#uid)',
              ExpressionAttributeNames: { '#uid': 'userId' },
            },
          },
          {
            Put: {
              TableName: OUTBOX_TABLE,
              Item: {
                outboxId,
                status: 'UNPROCESSED',
                eventType: 'social.reaction',
                queueName: 'social-reactions',
                payload: JSON.stringify({ targetId, userId, roomId, postId, emoji, timestamp: createdAt }),
                createdAt,
              },
            },
          },
        ],
      }));
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const reasons = err.CancellationReasons ?? [];
        if (reasons[0]?.Code === 'ConditionalCheckFailed') {
          res.status(409).json({ error: 'Already reacted. Delete your existing reaction first.' });
          return;
        }
      }
      throw err;
    }

    // Broadcast social:like (reaction) to room channel (non-fatal if Redis unavailable)
    let roomData = await getCachedRoom<{ channelId: string }>(roomId);
    if (!roomData) {
      const room = await roomRepo.getRoom(roomId);
      if (room) {
        roomData = room as { channelId: string };
        void setCachedRoom(roomId, room);
      }
    }
    if (roomData) {
      void broadcastService.emit(roomData.channelId, 'social:like', {
        targetId, userId, type: 'reaction', emoji, createdAt,
      });
    }

    res.status(201).json({ targetId, userId, type: 'reaction', emoji, createdAt });
    // No publishSocialEvent — outbox record handles delivery
  } catch (err) {
    console.error('[reactions] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/posts/:postId/reactions/:emoji — remove an emoji reaction from a post (REAC-05)
reactionsRouter.delete('/reactions/:emoji', requireRoomMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId } = req.params;
    const emoji = decodeURIComponent(req.params.emoji);
    const userId = req.user!.sub;

    // Validate emoji
    if (!VALID_EMOJI.has(emoji)) {
      res.status(400).json({ error: 'Invalid emoji' });
      return;
    }

    const targetId = `post:${postId}:reaction`;

    // Verify reaction exists before deleting
    const reactionResult = await docClient.send(new GetCommand({
      TableName: LIKES_TABLE,
      Key: { targetId, userId },
    }));
    if (!reactionResult.Item) {
      res.status(404).json({ error: 'Reaction not found' });
      return;
    }

    await docClient.send(new DeleteCommand({
      TableName: LIKES_TABLE,
      Key: { targetId, userId },
    }));

    res.status(204).send();
  } catch (err) {
    console.error('[reactions] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
