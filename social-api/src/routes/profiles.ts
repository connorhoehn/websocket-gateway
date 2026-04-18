import { Router, Request, Response } from 'express';
import { getCachedProfile, setCachedProfile, invalidateProfileCache } from '../lib/cache';
import { profileRepo } from '../repositories';
import type { ProfileItem } from '../repositories';
import {
  asyncHandler,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../middleware/error-handler';

export const profilesRouter = Router();

// POST /api/profiles — create own profile (PROF-01)
profilesRouter.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { displayName, bio, avatarUrl, visibility } = req.body as {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    visibility?: string;
  };

  // Validation
  if (!displayName || displayName.length < 1 || displayName.length > 50) {
    throw new ValidationError('displayName is required (max 50 chars)');
  }
  if (bio !== undefined && bio.length > 160) {
    throw new ValidationError('bio must be 160 chars or fewer');
  }
  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
    throw new ValidationError('visibility must be public or private');
  }

  const userId = req.user!.sub;

  // Check if profile already exists
  const existing = await profileRepo.getProfile(userId);
  if (existing) {
    throw new ConflictError('Profile already exists. Use PUT to update.');
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
}));

// GET /api/profiles/:userId — read profile with visibility gating (PROF-03, PROF-04, PROF-05)
profilesRouter.get('/:userId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

  // Check Redis cache first
  let item = await getCachedProfile<ProfileItem>(userId);

  if (!item) {
    item = await profileRepo.getProfile(userId);

    if (!item) {
      throw new NotFoundError('Profile not found');
    }

    // Populate cache on miss
    void setCachedProfile(userId, item);
  }

  // Visibility gate: private profile only visible to owner
  if (item.visibility === 'private' && req.user!.sub !== item.userId) {
    throw new ForbiddenError('This profile is private');
  }

  res.status(200).json(item);
}));

// PUT /api/profiles — update own profile (PROF-02)
profilesRouter.put('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { displayName, bio, avatarUrl, visibility } = req.body as {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    visibility?: string;
  };

  // Validation for provided fields
  if (displayName !== undefined && (displayName.length < 1 || displayName.length > 50)) {
    throw new ValidationError('displayName is required (max 50 chars)');
  }
  if (bio !== undefined && bio.length > 160) {
    throw new ValidationError('bio must be 160 chars or fewer');
  }
  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
    throw new ValidationError('visibility must be public or private');
  }

  const userId = req.user!.sub;

  // Check profile exists
  const existing = await profileRepo.getProfile(userId);
  if (!existing) {
    throw new NotFoundError('Profile not found. Use POST to create.');
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
}));
