import { v4 as uuidv4 } from 'uuid';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { Router, Request, Response } from 'express';
import { getCachedGroup, setCachedGroup, invalidateGroupCache } from '../lib/cache';
import { groupRepo } from '../repositories';
import type { GroupItem, GroupMemberItem } from '../repositories';

export const groupsRouter = Router();

// POST /api/groups — create a group (GRUP-01)
groupsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, visibility } = req.body as {
      name?: string;
      description?: string;
      visibility?: string;
    };

    // Validation
    if (!name || name.length < 1 || name.length > 100) {
      res.status(400).json({ error: 'name is required (max 100 chars)' });
      return;
    }
    if (description !== undefined && description.length > 500) {
      res.status(400).json({ error: 'description must be 500 chars or fewer' });
      return;
    }
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      res.status(400).json({ error: 'visibility must be public or private' });
      return;
    }

    const callerId = req.user!.sub;
    const groupId = uuidv4();
    const now = new Date().toISOString();

    const groupItem: GroupItem = {
      groupId,
      name,
      description: description ?? '',
      visibility: (visibility as 'public' | 'private') ?? 'public',
      ownerId: callerId,
      createdAt: now,
      updatedAt: now,
    };

    const memberItem: GroupMemberItem = {
      groupId,
      userId: callerId,
      role: 'owner',
      joinedAt: now,
    };

    try {
      await groupRepo.createGroupWithOwner(groupItem, memberItem);
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        res.status(409).json({ error: 'Group creation conflict — please retry' });
        return;
      }
      throw err;
    }

    // Populate cache with newly created group
    void setCachedGroup(groupId, groupItem);

    res.status(201).json({ ...groupItem, role: 'owner' });
  } catch (err) {
    console.error('POST /groups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/groups/:groupId — get group details
groupsRouter.get('/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;

    // Check Redis cache first
    let group = await getCachedGroup<GroupItem>(groupId);

    if (!group) {
      group = await groupRepo.getGroup(groupId);

      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      // Populate cache on miss
      void setCachedGroup(groupId, group);
    }

    // Check caller membership
    const memberItem = await groupRepo.getMembership(groupId, callerId);
    const isMember = memberItem !== null;

    // Private group gate: non-members cannot see it
    if (group.visibility === 'private' && !isMember) {
      res.status(403).json({ error: 'This group is private' });
      return;
    }

    res.status(200).json({ ...group, role: isMember ? memberItem!.role : null });
  } catch (err) {
    console.error('GET /groups/:groupId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/groups/:groupId — delete a group (GRUP-02)
groupsRouter.delete('/:groupId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;

    const group = await groupRepo.getGroup(groupId);

    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    if (group.ownerId !== callerId) {
      res.status(403).json({ error: 'Only the group owner can delete this group' });
      return;
    }

    await groupRepo.deleteGroup(groupId);

    // Invalidate cache for deleted group
    void invalidateGroupCache(groupId);

    res.status(200).json({ message: 'Group deleted' });
  } catch (err) {
    console.error('DELETE /groups/:groupId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/groups/:groupId/visibility — update visibility (GRUP-05)
groupsRouter.patch('/:groupId/visibility', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;
    const { visibility } = req.body as { visibility?: string };

    // Validate visibility first
    if (!visibility || (visibility !== 'public' && visibility !== 'private')) {
      res.status(400).json({ error: 'visibility must be public or private' });
      return;
    }

    const group = await groupRepo.getGroup(groupId);

    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    if (group.ownerId !== callerId) {
      res.status(403).json({ error: 'Only the group owner can change visibility' });
      return;
    }

    const updated = await groupRepo.updateGroupVisibility(groupId, visibility as 'public' | 'private');

    // Invalidate stale cache; next GET will re-populate
    void invalidateGroupCache(groupId);

    res.status(200).json(updated);
  } catch (err) {
    console.error('PATCH /groups/:groupId/visibility error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
