import { v4 as uuidv4 } from 'uuid';
import {
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient } from '../lib/aws-clients';
import { setCachedRoom } from '../lib/cache';
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';
const GROUPS_TABLE = 'social-groups';
const GROUP_MEMBERS_TABLE = 'social-group-members';

export const groupRoomsRouter = Router({ mergeParams: true });

interface RoomItem {
  roomId: string;
  channelId: string;
  name: string;
  type: 'standalone' | 'group' | 'dm';
  ownerId: string;
  groupId?: string;
  dmPeerUserId?: string;
  createdAt: string;
  updatedAt: string;
}

interface RoomMemberItem {
  roomId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

// POST /api/groups/:groupId/rooms — create group-scoped room (ROOM-02, ROOM-05)
groupRoomsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };

    if (!name || name.length < 1 || name.length > 100) {
      res.status(400).json({ error: 'name is required (max 100 chars)' });
      return;
    }

    // Verify group exists
    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId: req.params.groupId },
    }));
    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Group-admin guard — fetch caller's membership in the group
    const callerMember = await docClient.send(new GetCommand({
      TableName: GROUP_MEMBERS_TABLE,
      Key: { groupId: req.params.groupId, userId: req.user!.sub },
    }));
    const callerRole = callerMember.Item?.['role'] as string | undefined;
    // Treat absent status field as 'active'; treat invited-only as not a member
    const callerStatus = callerMember.Item?.['status'] as string | undefined;
    if (!callerRole || (callerStatus === 'invited') || (callerRole !== 'owner' && callerRole !== 'admin')) {
      res.status(403).json({ error: 'Only group owners and admins can create rooms' });
      return;
    }

    const roomId = uuidv4();
    const channelId = uuidv4();
    const now = new Date().toISOString();

    // Write room item to social-rooms
    await docClient.send(new PutCommand({
      TableName: ROOMS_TABLE,
      Item: {
        roomId,
        channelId,
        name: req.body.name,
        type: 'group',
        ownerId: req.user!.sub,
        groupId: req.params.groupId,
        createdAt: now,
        updatedAt: now,
      } as RoomItem,
    }));

    // Auto-enroll creator in social-room-members as owner
    await docClient.send(new PutCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Item: {
        roomId,
        userId: req.user!.sub,
        role: 'owner',
        joinedAt: now,
      } as RoomMemberItem,
    }));

    // Populate cache with newly created group room
    void setCachedRoom(roomId, {
      roomId, channelId, name: req.body.name, type: 'group',
      ownerId: req.user!.sub, groupId: req.params.groupId, createdAt: now, updatedAt: now,
    });

    res.status(201).json({ roomId, channelId, name: req.body.name, type: 'group', groupId: req.params.groupId, ownerId: req.user!.sub, role: 'owner', createdAt: now });
  } catch (err) {
    console.error('[group-rooms] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
