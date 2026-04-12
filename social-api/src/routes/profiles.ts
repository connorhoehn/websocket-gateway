import { Router, Request, Response } from 'express';
import { getCachedProfile, setCachedProfile, invalidateProfileCache } from '../lib/cache';
import { profileRepo } from '../repositories';
import type { ProfileItem } from '../repositories';

export const profilesRouter = Router();

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
    const existing = await profileRepo.getProfile(userId);
    if (existing) {
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

    await profileRepo.createProfile(item);

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
      item = await profileRepo.getProfile(userId);

      if (!item) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

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
    const existing = await profileRepo.getProfile(userId);
    if (!existing) {
      res.status(404).json({ error: 'Profile not found. Use POST to create.' });
      return;
    }

    const updated = await profileRepo.updateProfile(userId, {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(visibility !== undefined ? { visibility: visibility as 'public' | 'private' } : {}),
    });

    // Invalidate stale cache; next GET will re-populate
    void invalidateProfileCache(userId);

    res.status(200).json(updated);
  } catch (err) {
    console.error('PUT /profiles error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
