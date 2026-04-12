import { v4 as uuidv4 } from 'uuid';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient } from '../lib/aws-clients';
import { setCachedRoom } from '../lib/cache';
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';
const REL_TABLE = 'social-relationships';

export const roomsRouter = Router();

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

// POST /api/rooms/dm — create DM room (ROOM-03, ROOM-05)
// IMPORTANT: defined BEFORE /:roomId to avoid Express matching '/dm' as a roomId value
roomsRouter.post('/dm', async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetUserId } = req.body as { targetUserId?: string };

    if (!targetUserId) {
      res.status(400).json({ error: 'targetUserId is required' });
      return;
    }

    const callerId = req.user!.sub;

    if (targetUserId === callerId) {
      res.status(400).json({ error: 'Cannot create a DM with yourself' });
      return;
    }

    // Mutual-friend guard:
    // Check caller follows target
    const followingResult = await docClient.send(new QueryCommand({
      TableName: REL_TABLE,
      KeyConditionExpression: 'followerId = :fid',
      ExpressionAttributeValues: { ':fid': callerId },
    }));
    const followeeSet = new Set(
      (followingResult.Items ?? []).map(i => i['followeeId'] as string)
    );

    // Check target follows caller (point query — O(1), not scan)
    const reverseResult = await docClient.send(new GetCommand({
      TableName: REL_TABLE,
      Key: { followerId: targetUserId, followeeId: callerId },
    }));
    const targetFollowsCaller = !!reverseResult.Item;

    if (!followeeSet.has(targetUserId) || !targetFollowsCaller) {
      res.status(403).json({ error: 'DM rooms can only be created between mutual friends' });
      return;
    }

    // Deterministic DM roomId — sorted to ensure same key regardless of who initiates (ROOM-03)
    const dmRoomId = ['dm', ...[callerId, targetUserId].sort()].join('#');
    const channelId = uuidv4();
    const now = new Date().toISOString();

    // Write room item with ConditionExpression to prevent duplicate DM rooms (TOCTOU-safe)
    try {
      await docClient.send(new PutCommand({
        TableName: ROOMS_TABLE,
        Item: {
          roomId: dmRoomId,
          channelId,
          name: `dm-${callerId.slice(-6)}-${targetUserId.slice(-6)}`,
          type: 'dm',
          ownerId: callerId,
          dmPeerUserId: targetUserId,
          createdAt: now,
          updatedAt: now,
        } as RoomItem,
        ConditionExpression: 'attribute_not_exists(roomId)',
      }));
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'ConditionalCheckFailedException'
      ) {
        res.status(409).json({ error: 'A DM room already exists between these two users', roomId: dmRoomId });
        return;
      }
      throw err;
    }

    // Auto-enroll BOTH users: caller as 'owner', peer as 'member'
    await docClient.send(new PutCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Item: { roomId: dmRoomId, userId: callerId, role: 'owner', joinedAt: now } as RoomMemberItem,
    }));
    await docClient.send(new PutCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Item: { roomId: dmRoomId, userId: targetUserId, role: 'member', joinedAt: now } as RoomMemberItem,
    }));

    // Populate cache with newly created DM room
    void setCachedRoom(dmRoomId, {
      roomId: dmRoomId, channelId, name: `dm-${callerId.slice(-6)}-${targetUserId.slice(-6)}`,
      type: 'dm', ownerId: callerId, dmPeerUserId: targetUserId, createdAt: now, updatedAt: now,
    });

    res.status(201).json({ roomId: dmRoomId, channelId, type: 'dm', dmPeerUserId: targetUserId, createdAt: now });
  } catch (err) {
    console.error('[rooms] POST /dm error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/rooms — create standalone room (ROOM-01, ROOM-05, ROOM-07)
roomsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };

    if (!name || name.length < 1 || name.length > 100) {
      res.status(400).json({ error: 'name is required (max 100 chars)' });
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
        type: 'standalone',
        ownerId: req.user!.sub,
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

    // Populate cache with newly created room
    void setCachedRoom(roomId, {
      roomId, channelId, name: req.body.name, type: 'standalone',
      ownerId: req.user!.sub, createdAt: now, updatedAt: now,
    });

    res.status(201).json({ roomId, channelId, name: req.body.name, type: 'standalone', ownerId: req.user!.sub, role: 'owner', createdAt: now });
  } catch (err) {
    console.error('[rooms] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
