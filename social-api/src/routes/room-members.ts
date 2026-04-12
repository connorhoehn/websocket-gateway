import { ulid } from 'ulid';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';
import { publishSocialEvent } from '../lib/aws-clients';
import { getCachedRoom, setCachedRoom } from '../lib/cache';
import { roomRepo } from '../repositories';
import type { RoomItem, RoomMemberItem } from '../repositories';

export const roomMembersRouter = Router({ mergeParams: true });

// POST /api/rooms/:roomId/join — join a room (ROOM-04)
roomMembersRouter.post('/join', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify room exists (check cache first)
    let roomItem = await getCachedRoom<RoomItem>(req.params.roomId);
    if (!roomItem) {
      roomItem = await roomRepo.getRoom(req.params.roomId);
      if (!roomItem) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      void setCachedRoom(req.params.roomId, roomItem);
    }

    // Check if caller is already a member
    const existing = await roomRepo.getMembership(req.params.roomId, req.user!.sub);
    if (existing) {
      res.status(409).json({ error: 'Already a member of this room' });
      return;
    }

    // Write member record + outbox record atomically
    const outboxId = ulid();
    const now = new Date().toISOString();

    const memberItem: RoomMemberItem = {
      roomId: req.params.roomId,
      userId: req.user!.sub,
      role: 'member',
      joinedAt: now,
    };

    await roomRepo.addMemberWithOutbox(memberItem, {
      outboxId,
      status: 'UNPROCESSED',
      eventType: 'social.room.join',
      queueName: 'social-rooms',
      payload: JSON.stringify({ roomId: req.params.roomId, userId: req.user!.sub, timestamp: now }),
      createdAt: now,
    });

    res.status(201).json({ roomId: req.params.roomId, userId: req.user!.sub, role: 'member', joinedAt: now });

    // Broadcast social:member_joined to room channel (non-fatal if Redis unavailable)
    if (roomItem) {
      void broadcastService.emit(roomItem.channelId, 'social:member_joined', {
        roomId: req.params.roomId, userId: req.user!.sub, joinedAt: now,
      });
    }
    // No publishSocialEvent — outbox record handles delivery
  } catch (err) {
    console.error('[room-members] POST /join error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/rooms/:roomId/leave — leave a room (RTIM-04 leave half)
roomMembersRouter.delete('/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify room exists and get channelId for broadcast
    const roomItem = await roomRepo.getRoom(req.params.roomId);
    if (!roomItem) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    // Verify caller is a member
    const membership = await roomRepo.getMembership(req.params.roomId, req.user!.sub);
    if (!membership) {
      res.status(404).json({ error: 'You are not a member of this room' });
      return;
    }

    // Owners cannot leave their own room (prevents orphaned rooms)
    if (membership.role === 'owner') {
      res.status(403).json({ error: 'Room owners cannot leave their own room' });
      return;
    }

    // Delete member record
    await roomRepo.removeMember(req.params.roomId, req.user!.sub);

    res.status(200).json({ roomId: req.params.roomId, userId: req.user!.sub, left: true });

    // Broadcast social:member_left to room channel (non-fatal if Redis unavailable)
    void broadcastService.emit(roomItem.channelId, 'social:member_left', {
      roomId: req.params.roomId, userId: req.user!.sub, leftAt: new Date().toISOString(),
    });
    // Publish social.room.leave event to EventBridge (log-and-continue)
    void publishSocialEvent('social.room.leave', {
      roomId: req.params.roomId,
      userId: req.user!.sub,
    });
  } catch (err) {
    console.error('[room-members] DELETE /leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms/:roomId/members — list room members (ROOM-06)
roomMembersRouter.get('/members', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify room exists
    const roomItem = await roomRepo.getRoom(req.params.roomId);
    if (!roomItem) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    // Check caller is a member (authorization gate)
    const callerMembership = await roomRepo.getMembership(req.params.roomId, req.user!.sub);
    if (!callerMembership) {
      res.status(403).json({ error: 'You are not a member of this room' });
      return;
    }

    // Query all members of this room
    const members = await roomRepo.getRoomMembers(req.params.roomId);

    const result = members.map(item => ({
      roomId: item.roomId,
      userId: item.userId,
      role: item.role,
      joinedAt: item.joinedAt,
    }));

    res.status(200).json({ members: result });
  } catch (err) {
    console.error('[room-members] GET /members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms — list all rooms the caller belongs to (ROOM-08)
// Uses GSI userId-roomId-index on social-room-members to avoid full-table Scan
// NOTE: Mounted as a separate top-level router at /rooms in index.ts
export const myRoomsRouter = Router();

myRoomsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const rooms = await roomRepo.getRoomsByUser(req.user!.sub);

    res.status(200).json({ rooms });
  } catch (err) {
    console.error('[room-members] GET /rooms error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
