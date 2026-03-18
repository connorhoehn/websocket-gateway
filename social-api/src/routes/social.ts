import {
  PutCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  BatchGetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient, publishSocialEvent } from '../lib/aws-clients';
const REL_TABLE = 'social-relationships';
const PROF_TABLE = 'social-profiles';

export const socialRouter = Router();

interface PublicProfile {
  userId: string;
  displayName: string;
  avatarUrl: string;
  visibility: string;
}

// Helper: batch-get public profile fields for a list of user IDs
async function enrichWithProfiles(userIds: string[]): Promise<PublicProfile[]> {
  if (userIds.length === 0) return [];

  const batchResult = await docClient.send(
    new BatchGetCommand({
      RequestItems: {
        [PROF_TABLE]: {
          Keys: userIds.map((id) => ({ userId: id })),
        },
      },
    }),
  );

  const items = batchResult.Responses?.[PROF_TABLE] ?? [];
  return items.map((item) => ({
    userId: item['userId'] as string,
    displayName: item['displayName'] as string,
    avatarUrl: item['avatarUrl'] as string,
    visibility: item['visibility'] as string,
  }));
}

// POST /api/social/follow/:userId — follow a user (SOCL-01)
socialRouter.post('/follow/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const followerId = req.user!.sub;
    const followeeId = req.params['userId'];

    if (followerId === followeeId) {
      res.status(400).json({ error: 'Cannot follow yourself' });
      return;
    }

    try {
      await docClient.send(
        new PutCommand({
          TableName: REL_TABLE,
          Item: {
            followerId,
            followeeId,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(followerId)',
        }),
      );
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'ConditionalCheckFailedException'
      ) {
        res.status(409).json({ error: 'Already following this user' });
        return;
      }
      throw err;
    }

    res.status(201).json({ followerId, followeeId });
    // Publish social.follow event to EventBridge (log-and-continue)
    void publishSocialEvent('social.follow', {
      followerId,
      followeeId,
    });
  } catch (err) {
    console.error('POST /social/follow/:userId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/social/follow/:userId — unfollow a user (SOCL-02)
socialRouter.delete('/follow/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const followerId = req.user!.sub;
    const followeeId = req.params['userId'];

    const existing = await docClient.send(
      new GetCommand({
        TableName: REL_TABLE,
        Key: { followerId, followeeId },
      }),
    );

    if (!existing.Item) {
      res.status(404).json({ error: 'Not following this user' });
      return;
    }

    await docClient.send(
      new DeleteCommand({
        TableName: REL_TABLE,
        Key: { followerId, followeeId },
      }),
    );

    res.status(200).json({ message: 'Unfollowed successfully' });
    // Publish social.unfollow event to EventBridge (log-and-continue)
    void publishSocialEvent('social.unfollow', {
      followerId,
      followeeId,
    });
  } catch (err) {
    console.error('DELETE /social/follow/:userId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/followers — list users who follow the caller (SOCL-04)
// NOTE: social-relationships has no GSI on followeeId; scan with FilterExpression
socialRouter.get('/followers', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerId = req.user!.sub;

    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: REL_TABLE,
        FilterExpression: 'followeeId = :fid',
        ExpressionAttributeValues: { ':fid': callerId },
      }),
    );

    const followerIds = (scanResult.Items ?? []).map((i) => i['followerId'] as string);

    if (followerIds.length === 0) {
      res.status(200).json({ followers: [] });
      return;
    }

    const followers = await enrichWithProfiles(followerIds);
    res.status(200).json({ followers });
  } catch (err) {
    console.error('GET /social/followers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/following — list users the caller follows (SOCL-05)
socialRouter.get('/following', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerId = req.user!.sub;

    const result = await docClient.send(
      new QueryCommand({
        TableName: REL_TABLE,
        KeyConditionExpression: 'followerId = :fid',
        ExpressionAttributeValues: { ':fid': callerId },
      }),
    );

    const followeeIds = (result.Items ?? []).map((i) => i['followeeId'] as string);

    if (followeeIds.length === 0) {
      res.status(200).json({ following: [] });
      return;
    }

    const following = await enrichWithProfiles(followeeIds);
    res.status(200).json({ following });
  } catch (err) {
    console.error('GET /social/following error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/social/friends — mutual follows (SOCL-03, SOCL-06)
// A "friend" = someone where caller follows them AND they follow caller
socialRouter.get('/friends', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerId = req.user!.sub;

    // 1. Get everyone caller follows (PK query — no scan needed)
    const followingResult = await docClient.send(
      new QueryCommand({
        TableName: REL_TABLE,
        KeyConditionExpression: 'followerId = :fid',
        ExpressionAttributeValues: { ':fid': callerId },
      }),
    );
    const followeeSet = new Set(
      (followingResult.Items ?? []).map((i) => i['followeeId'] as string),
    );

    // 2. Get everyone who follows caller (scan — no GSI available)
    const followersResult = await docClient.send(
      new ScanCommand({
        TableName: REL_TABLE,
        FilterExpression: 'followeeId = :fid',
        ExpressionAttributeValues: { ':fid': callerId },
      }),
    );
    const followerSet = new Set(
      (followersResult.Items ?? []).map((i) => i['followerId'] as string),
    );

    // 3. Intersect: mutual follows only
    const friendIds = [...followeeSet].filter((id) => followerSet.has(id));

    if (friendIds.length === 0) {
      res.status(200).json({ friends: [] });
      return;
    }

    const friends = await enrichWithProfiles(friendIds);
    res.status(200).json({ friends });
  } catch (err) {
    console.error('GET /social/friends error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
