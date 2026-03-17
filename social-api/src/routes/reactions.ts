import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddb);
const LIKES_TABLE = 'social-likes';
const POSTS_TABLE = 'social-posts';
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';

const VALID_EMOJI = new Set(['❤️', '😂', '👍', '👎', '😮', '😢', '😡', '🎉', '🔥', '⚡', '💯', '🚀']);

// reactionsRouter is mounted at /rooms/:roomId/posts/:postId — mergeParams:true exposes :roomId and :postId
export const reactionsRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/posts/:postId/reactions — add an emoji reaction to a post (REAC-05)
// Body: { emoji: string }
reactionsRouter.post('/reactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const { emoji } = req.body as { emoji?: string };
    const userId = req.user!.sub;

    // Validate emoji
    if (!emoji || !VALID_EMOJI.has(emoji)) {
      res.status(400).json({ error: 'Invalid emoji. Must be one of the 12 supported types' });
      return;
    }

    // Membership gate — caller must be a member of the room
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to react' });
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

    await docClient.send(new PutCommand({
      TableName: LIKES_TABLE,
      Item: { targetId, userId, type: 'reaction', emoji, createdAt },
      ConditionExpression: 'attribute_not_exists(#uid)',
      ExpressionAttributeNames: { '#uid': 'userId' },
    }));

    // Broadcast social:like (reaction) to room channel (non-fatal if Redis unavailable)
    const roomForBroadcast = await docClient.send(new GetCommand({
      TableName: ROOMS_TABLE,
      Key: { roomId },
    }));
    if (roomForBroadcast.Item) {
      void broadcastService.emit(roomForBroadcast.Item['channelId'] as string, 'social:like', {
        targetId, userId, type: 'reaction', emoji, createdAt,
      });
    }

    res.status(201).json({ targetId, userId, type: 'reaction', emoji, createdAt });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      res.status(409).json({ error: 'Already reacted. Delete your existing reaction first.' });
      return;
    }
    console.error('[reactions] handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/posts/:postId/reactions/:emoji — remove an emoji reaction from a post (REAC-05)
reactionsRouter.delete('/reactions/:emoji', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const emoji = decodeURIComponent(req.params.emoji);
    const userId = req.user!.sub;

    // Validate emoji
    if (!VALID_EMOJI.has(emoji)) {
      res.status(400).json({ error: 'Invalid emoji' });
      return;
    }

    // Membership gate
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to remove a reaction' });
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
