import { ulid } from 'ulid';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient, publishSocialEvent } from '../lib/aws-clients';
import { broadcastToRoom } from '../services/room-broadcaster';
import { requireRoomMembership } from '../middleware/require-membership';
import {
  asyncHandler,
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../middleware/error-handler';
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
commentsRouter.post('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { roomId, postId } = req.params;
  const { content, parentCommentId } = req.body as { content?: string; parentCommentId?: string };
  const authorId = req.user!.sub;

  const trimmedContent = (content ?? '').trim();
  if (!trimmedContent || trimmedContent.length > 10000) {
    throw new ValidationError('content is required (max 10000 chars)');
  }

  // Verify post exists
  const postResult = await docClient.send(new GetCommand({
    TableName: POSTS_TABLE,
    Key: { roomId, postId },
  }));
  if (!postResult.Item) {
    throw new NotFoundError('Post not found');
  }

  // If replying, verify parent comment exists
  if (parentCommentId) {
    const parentResult = await docClient.send(new GetCommand({
      TableName: COMMENTS_TABLE,
      Key: { postId, commentId: parentCommentId },
    }));
    if (!parentResult.Item) {
      throw new NotFoundError('Parent comment not found');
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
  await broadcastToRoom(roomId, 'social:comment', {
    roomId, postId, commentId, authorId, content: trimmedContent,
    ...(parentCommentId ? { parentCommentId } : {}),
    createdAt: now,
  });

  res.status(201).json(item);

  // Publish social.comment.created event to EventBridge (log-and-continue)
  void publishSocialEvent('social.comment.created', {
    roomId,
    postId,
    commentId,
    authorId,
  });
}));

// GET /api/rooms/:roomId/posts/:postId/comments — list all comments for a post (flat array; clients group by parentCommentId)
commentsRouter.get('/', requireRoomMembership, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { roomId, postId } = req.params;

  // Verify post exists
  const postResult = await docClient.send(new GetCommand({
    TableName: POSTS_TABLE,
    Key: { roomId, postId },
  }));
  if (!postResult.Item) {
    throw new NotFoundError('Post not found');
  }

  const result = await docClient.send(new QueryCommand({
    TableName: COMMENTS_TABLE,
    KeyConditionExpression: 'postId = :pid',
    ExpressionAttributeValues: { ':pid': postId },
    ScanIndexForward: false,   // ULID sort key → newest-first
  }));

  const comments = (result.Items ?? []) as CommentItem[];
  res.status(200).json({ comments });
}));

// DELETE /api/rooms/:roomId/posts/:postId/comments/:commentId — delete own comment (CONT-08)
commentsRouter.delete('/:commentId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { postId, commentId } = req.params;
  const callerId = req.user!.sub;

  // Fetch comment to verify existence and ownership
  const result = await docClient.send(new GetCommand({
    TableName: COMMENTS_TABLE,
    Key: { postId, commentId },
  }));
  if (!result.Item) {
    throw new NotFoundError('Comment not found');
  }
  if (result.Item['authorId'] !== callerId) {
    throw new ForbiddenError('You can only delete your own comments');
  }

  await docClient.send(new DeleteCommand({
    TableName: COMMENTS_TABLE,
    Key: { postId, commentId },
  }));

  res.status(204).send();
}));
