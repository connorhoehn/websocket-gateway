import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient } from '../lib/aws-clients';
import { getCachedProfile, setCachedProfile, invalidateProfileCache } from '../lib/cache';
const TABLE = 'social-profiles';

export const profilesRouter = Router();

interface ProfileItem {
  userId: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}

// POST /api/profiles — create own profile (PROF-01)
profilesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { displayName, bio, avatarUrl, visibility } = req.body as {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
      visibility?: string;
    };

    // Validation
    if (!displayName || displayName.length < 1 || displayName.length > 50) {
      res.status(400).json({ error: 'displayName is required (max 50 chars)' });
      return;
    }
    if (bio !== undefined && bio.length > 160) {
      res.status(400).json({ error: 'bio must be 160 chars or fewer' });
      return;
    }
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      res.status(400).json({ error: 'visibility must be public or private' });
      return;
    }

    const userId = req.user!.sub;

    // Check if profile already exists
    const existing = await docClient.send(new GetCommand({
      TableName: TABLE,
      Key: { userId },
    }));
    if (existing.Item) {
      res.status(409).json({ error: 'Profile already exists. Use PUT to update.' });
      return;
    }

    const now = new Date().toISOString();
    const item: ProfileItem = {
      userId,
      displayName,
      bio: bio ?? '',
      avatarUrl: avatarUrl ?? '',
      visibility: (visibility as 'public' | 'private') ?? 'public',
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: item,
    }));

    // Populate cache with newly created profile
    void setCachedProfile(userId, item);

    res.status(201).json(item);
  } catch (err) {
    console.error('POST /profiles error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/profiles/:userId — read profile with visibility gating (PROF-03, PROF-04, PROF-05)
profilesRouter.get('/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    // Check Redis cache first
    let item = await getCachedProfile<ProfileItem>(userId);

    if (!item) {
      const result = await docClient.send(new GetCommand({
        TableName: TABLE,
        Key: { userId },
      }));

      if (!result.Item) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      item = result.Item as ProfileItem;

      // Populate cache on miss
      void setCachedProfile(userId, item);
    }

    // Visibility gate: private profile only visible to owner
    if (item.visibility === 'private' && req.user!.sub !== item.userId) {
      res.status(403).json({ error: 'This profile is private' });
      return;
    }

    res.status(200).json(item);
  } catch (err) {
    console.error('GET /profiles/:userId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/profiles — update own profile (PROF-02)
profilesRouter.put('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { displayName, bio, avatarUrl, visibility } = req.body as {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
      visibility?: string;
    };

    // Validation for provided fields
    if (displayName !== undefined && (displayName.length < 1 || displayName.length > 50)) {
      res.status(400).json({ error: 'displayName is required (max 50 chars)' });
      return;
    }
    if (bio !== undefined && bio.length > 160) {
      res.status(400).json({ error: 'bio must be 160 chars or fewer' });
      return;
    }
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      res.status(400).json({ error: 'visibility must be public or private' });
      return;
    }

    const userId = req.user!.sub;

    // Check profile exists
    const existing = await docClient.send(new GetCommand({
      TableName: TABLE,
      Key: { userId },
    }));
    if (!existing.Item) {
      res.status(404).json({ error: 'Profile not found. Use POST to create.' });
      return;
    }

    // Build dynamic UpdateExpression
    const updates: string[] = [];
    const exprValues: Record<string, unknown> = {};

    if (displayName !== undefined) {
      updates.push('displayName = :displayName');
      exprValues[':displayName'] = displayName;
    }
    if (bio !== undefined) {
      updates.push('bio = :bio');
      exprValues[':bio'] = bio;
    }
    if (avatarUrl !== undefined) {
      updates.push('avatarUrl = :avatarUrl');
      exprValues[':avatarUrl'] = avatarUrl;
    }
    if (visibility !== undefined) {
      updates.push('visibility = :visibility');
      exprValues[':visibility'] = visibility;
    }
    updates.push('updatedAt = :updatedAt');
    exprValues[':updatedAt'] = new Date().toISOString();

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { userId },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }));

    const updated = result.Attributes as ProfileItem;

    // Invalidate stale cache; next GET will re-populate
    void invalidateProfileCache(userId);

    res.status(200).json(updated);
  } catch (err) {
    console.error('PUT /profiles error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
