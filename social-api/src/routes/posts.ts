import { ulid } from 'ulid';
import {
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';
import { docClient } from '../lib/aws-clients';
import { getCachedRoom, setCachedRoom } from '../lib/cache';
import { roomRepo } from '../repositories';
import { requireRoomMembership } from '../middleware/require-membership';
const POSTS_TABLE = 'social-posts';
const OUTBOX_TABLE = 'social-outbox';

// postsRouter is mounted at /rooms/:roomId — mergeParams:true exposes :roomId
export const postsRouter = Router({ mergeParams: true });

interface PostItem {
  roomId: string;
  postId: string;  // ULID — lexicographically time-sortable
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// POST /api/rooms/:roomId/posts — create a post (CONT-01)
postsRouter.post('/', requireRoomMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const { content } = req.body as { content?: string };
    const authorId = req.user!.sub;

    const trimmedContent = (content ?? '').trim();
    if (!trimmedContent || trimmedContent.length > 10000) {
      res.status(400).json({ error: 'content is required (max 10000 chars)' });
      return;
    }

    const postId = ulid();
    const now = new Date().toISOString();

    const outboxId = ulid();
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: POSTS_TABLE,
            Item: {
              roomId,
              postId,
              authorId,
              content: trimmedContent,
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        {
          Put: {
            TableName: OUTBOX_TABLE,
            Item: {
              outboxId,
              status: 'UNPROCESSED',
              eventType: 'social.post.created',
              queueName: 'social-posts',
              payload: JSON.stringify({ roomId, postId, authorId, timestamp: now }),
              createdAt: now,
            },
          },
        },
      ],
    }));

    // Broadcast social:post to room channel (non-fatal if Redis unavailable)
    // Use cached room metadata to avoid extra DynamoDB read on every post
    let roomData = await getCachedRoom<{ channelId: string }>(roomId);
    if (!roomData) {
      const room = await roomRepo.getRoom(roomId);
      if (room) {
        roomData = room as { channelId: string };
        void setCachedRoom(roomId, room);
      }
    }
    if (roomData) {
      void broadcastService.emit(roomData.channelId, 'social:post', {
        roomId, postId, authorId, content: trimmedContent, createdAt: now,
      });
    }

    res.status(201).json({ roomId, postId, authorId, content: trimmedContent, createdAt: now });
    // No publishSocialEvent — outbox record handles delivery
  } catch (err) {
    console.error('[posts] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/rooms/:roomId/posts/:postId — edit own post (CONT-02)
postsRouter.put('/:postId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const { content } = req.body as { content?: string };
    const callerId = req.user!.sub;

    const trimmedContent = (content ?? '').trim();
    if (!trimmedContent || trimmedContent.length > 10000) {
      res.status(400).json({ error: 'content is required (max 10000 chars)' });
      return;
    }

    // Fetch the post to verify it exists and caller is the author
    const result = await docClient.send(new QueryCommand({
      TableName: POSTS_TABLE,
      KeyConditionExpression: 'roomId = :rid AND postId = :pid',
      ExpressionAttributeValues: { ':rid': roomId, ':pid': postId },
    }));
    const post = result.Items?.[0];
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    if (post['authorId'] !== callerId) {
      res.status(403).json({ error: 'You can only edit your own posts' });
      return;
    }

    const now = new Date().toISOString();
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(new UpdateCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
      UpdateExpression: 'SET #c = :content, updatedAt = :now',
      ExpressionAttributeNames: { '#c': 'content' },
      ExpressionAttributeValues: { ':content': trimmedContent, ':now': now },
    }));

    res.status(200).json({ roomId, postId, content: trimmedContent, updatedAt: now });
  } catch (err) {
    console.error('[posts] PUT /:postId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/posts/:postId — delete own post (CONT-03)
postsRouter.delete('/:postId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const callerId = req.user!.sub;

    // Fetch post to verify existence and ownership
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await docClient.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
    }));
    if (!result.Item) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }
    if (result.Item['authorId'] !== callerId) {
      res.status(403).json({ error: 'You can only delete your own posts' });
      return;
    }

    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
    }));

    res.status(204).send();
  } catch (err) {
    console.error('[posts] DELETE /:postId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms/:roomId/posts — paginated room feed, newest-first (CONT-04)
// Uses ULID sort key with ScanIndexForward:false for descending chronological order.
// Accepts optional query params: ?limit=20&cursor=NEXT_PAGE_TOKEN (base64 of ExclusiveStartKey JSON)
postsRouter.get('/', requireRoomMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;

    const limit = Math.min(parseInt(req.query['limit'] as string ?? '20', 10) || 20, 100);
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (req.query['cursor']) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(req.query['cursor'] as string, 'base64').toString('utf8'));
      } catch {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
    }

    const result = await docClient.send(new QueryCommand({
      TableName: POSTS_TABLE,
      KeyConditionExpression: 'roomId = :rid',
      ExpressionAttributeValues: { ':rid': roomId },
      ScanIndexForward: false,   // ULID sort key → newest-first
      Limit: limit,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }));

    const posts = (result.Items ?? []) as PostItem[];
    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    res.status(200).json({ posts, nextCursor });
  } catch (err) {
    console.error('[posts] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// userPostsRouter is mounted at /posts in index.ts (top-level, no roomId context)
// GET /api/posts?userId=:uid — get all posts by a user across all rooms (CONT-05)
// Uses GSI authorId-postId-index to avoid full-table Scan
export const userPostsRouter = Router();

userPostsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.query['userId'] as string) ?? req.user!.sub;

    const result = await docClient.send(new QueryCommand({
      TableName: POSTS_TABLE,
      IndexName: 'authorId-postId-index',
      KeyConditionExpression: 'authorId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,   // ULID sort key → newest-first
    }));

    const posts = (result.Items ?? []) as PostItem[];

    res.status(200).json({ posts });
  } catch (err) {
    console.error('[posts] GET /posts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
