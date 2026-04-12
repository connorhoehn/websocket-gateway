import { ulid } from 'ulid';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';
import { docClient, publishSocialEvent } from '../lib/aws-clients';
import { getCachedRoom, setCachedRoom } from '../lib/cache';
import { roomRepo } from '../repositories';
import { requireRoomMembership } from '../middleware/require-membership';
const COMMENTS_TABLE = 'social-comments';
const POSTS_TABLE = 'social-posts';

// commentsRouter is mounted at /rooms/:roomId/posts/:postId — mergeParams:true exposes :roomId and :postId
export const commentsRouter = Router({ mergeParams: true });

interface CommentItem {
  postId: string;
  commentId: string;       // ULID — lexicographically time-sortable
  authorId: string;
  content: string;
  parentCommentId?: string; // undefined = top-level; set = reply to parentCommentId
  createdAt: string;
}

// POST /api/rooms/:roomId/posts/:postId/comments — create a comment or reply (CONT-06, CONT-07)
// Body: { content: string, parentCommentId?: string }
// - If parentCommentId is omitted: creates top-level comment (CONT-06)
// - If parentCommentId is provided: creates reply to that comment (CONT-07)
commentsRouter.post('/', requireRoomMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const { content, parentCommentId } = req.body as { content?: string; parentCommentId?: string };
    const authorId = req.user!.sub;

    const trimmedContent = (content ?? '').trim();
    if (!trimmedContent || trimmedContent.length > 10000) {
      res.status(400).json({ error: 'content is required (max 10000 chars)' });
      return;
    }

    // Verify post exists
    const postResult = await docClient.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
    }));
    if (!postResult.Item) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // If replying, verify parent comment exists
    if (parentCommentId) {
      const parentResult = await docClient.send(new GetCommand({
        TableName: COMMENTS_TABLE,
        Key: { postId, commentId: parentCommentId },
      }));
      if (!parentResult.Item) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
    }

    const commentId = ulid();
    const now = new Date().toISOString();

    const item: CommentItem = {
      postId,
      commentId,
      authorId,
      content: trimmedContent,
      createdAt: now,
      ...(parentCommentId ? { parentCommentId } : {}),
    };

    await docClient.send(new PutCommand({
      TableName: COMMENTS_TABLE,
      Item: item,
    }));

    // Broadcast social:comment to room channel (non-fatal if Redis unavailable)
    let roomData = await getCachedRoom<{ channelId: string }>(roomId);
    if (!roomData) {
      const room = await roomRepo.getRoom(roomId);
      if (room) {
        roomData = room as { channelId: string };
        void setCachedRoom(roomId, room);
      }
    }
    if (roomData) {
      void broadcastService.emit(roomData.channelId, 'social:comment', {
        roomId, postId, commentId, authorId, content: trimmedContent,
        ...(parentCommentId ? { parentCommentId } : {}),
        createdAt: now,
      });
    }

    res.status(201).json(item);

    // Publish social.comment.created event to EventBridge (log-and-continue)
    void publishSocialEvent('social.comment.created', {
      roomId,
      postId,
      commentId,
      authorId,
    });
  } catch (err) {
    console.error('[comments] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms/:roomId/posts/:postId/comments — list all comments for a post (flat array; clients group by parentCommentId)
commentsRouter.get('/', requireRoomMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;

    // Verify post exists
    const postResult = await docClient.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { roomId, postId },
    }));
    if (!postResult.Item) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const result = await docClient.send(new QueryCommand({
      TableName: COMMENTS_TABLE,
      KeyConditionExpression: 'postId = :pid',
      ExpressionAttributeValues: { ':pid': postId },
      ScanIndexForward: false,   // ULID sort key → newest-first
    }));

    const comments = (result.Items ?? []) as CommentItem[];
    res.status(200).json({ comments });
  } catch (err) {
    console.error('[comments] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/posts/:postId/comments/:commentId — delete own comment (CONT-08)
commentsRouter.delete('/:commentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId, commentId } = req.params;
    const callerId = req.user!.sub;

    // Fetch comment to verify existence and ownership
    const result = await docClient.send(new GetCommand({
      TableName: COMMENTS_TABLE,
      Key: { postId, commentId },
    }));
    if (!result.Item) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    if (result.Item['authorId'] !== callerId) {
      res.status(403).json({ error: 'You can only delete your own comments' });
      return;
    }

    await docClient.send(new DeleteCommand({
      TableName: COMMENTS_TABLE,
      Key: { postId, commentId },
    }));

    res.status(204).send();
  } catch (err) {
    console.error('[comments] DELETE /:commentId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
