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
const COMMENTS_TABLE = 'social-comments';
const POSTS_TABLE = 'social-posts';
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';

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
commentsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const { content, parentCommentId } = req.body as { content?: string; parentCommentId?: string };
    const authorId = req.user!.sub;

    if (!content || content.trim().length === 0 || content.length > 10000) {
      res.status(400).json({ error: 'content is required (max 10000 chars)' });
      return;
    }

    // Membership gate — caller must be a member of the room
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId: authorId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to comment' });
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
      content: content.trim(),
      createdAt: now,
      ...(parentCommentId ? { parentCommentId } : {}),
    };

    await docClient.send(new PutCommand({
      TableName: COMMENTS_TABLE,
      Item: item,
    }));

    // Broadcast social:comment to room channel (non-fatal if Redis unavailable)
    const roomForBroadcast = await docClient.send(new GetCommand({
      TableName: ROOMS_TABLE,
      Key: { roomId },
    }));
    if (roomForBroadcast.Item) {
      void broadcastService.emit(roomForBroadcast.Item['channelId'] as string, 'social:comment', {
        roomId, postId, commentId, authorId, content: content.trim(),
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
commentsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, postId } = req.params;
    const callerId = req.user!.sub;

    // Membership gate
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId, userId: callerId },
    }));
    if (!membership.Item) {
      res.status(403).json({ error: 'You must be a member of this room to view comments' });
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
