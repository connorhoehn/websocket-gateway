import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { Router, Request, Response } from 'express';
import { broadcastService } from '../services/broadcast';
import { docClient, publishSocialEvent } from '../lib/aws-clients';
import { getCachedRoom, setCachedRoom } from '../lib/cache';
const ROOMS_TABLE = 'social-rooms';
const ROOM_MEMBERS_TABLE = 'social-room-members';
const OUTBOX_TABLE = 'social-outbox';

export const roomMembersRouter = Router({ mergeParams: true });

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

// POST /api/rooms/:roomId/join — join a room (ROOM-04)
roomMembersRouter.post('/join', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify room exists (check cache first)
    let roomItem = await getCachedRoom<RoomItem>(req.params.roomId);
    if (!roomItem) {
      const roomResult = await docClient.send(new GetCommand({
        TableName: ROOMS_TABLE,
        Key: { roomId: req.params.roomId },
      }));
      if (!roomResult.Item) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }
      roomItem = roomResult.Item as RoomItem;
      void setCachedRoom(req.params.roomId, roomItem);
    }

    // Check if caller is already a member
    const existing = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId: req.params.roomId, userId: req.user!.sub },
    }));
    if (existing.Item) {
      res.status(409).json({ error: 'Already a member of this room' });
      return;
    }

    // Write member record + outbox record atomically
    const outboxId = ulid();
    const now = new Date().toISOString();

    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: ROOM_MEMBERS_TABLE,
            Item: {
              roomId: req.params.roomId,
              userId: req.user!.sub,
              role: 'member',
              joinedAt: now,
            },
          },
        },
        {
          Put: {
            TableName: OUTBOX_TABLE,
            Item: {
              outboxId,
              status: 'UNPROCESSED',
              eventType: 'social.room.join',
              queueName: 'social-rooms',
              payload: JSON.stringify({ roomId: req.params.roomId, userId: req.user!.sub, timestamp: now }),
              createdAt: now,
            },
          },
        },
      ],
    }));

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
    const roomResult = await docClient.send(new GetCommand({
      TableName: ROOMS_TABLE,
      Key: { roomId: req.params.roomId },
    }));
    if (!roomResult.Item) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    // Verify caller is a member
    const membership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId: req.params.roomId, userId: req.user!.sub },
    }));
    if (!membership.Item) {
      res.status(404).json({ error: 'You are not a member of this room' });
      return;
    }

    // Owners cannot leave their own room (prevents orphaned rooms)
    if ((membership.Item as RoomMemberItem).role === 'owner') {
      res.status(403).json({ error: 'Room owners cannot leave their own room' });
      return;
    }

    // Delete member record
    await docClient.send(new DeleteCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId: req.params.roomId, userId: req.user!.sub },
    }));

    res.status(200).json({ roomId: req.params.roomId, userId: req.user!.sub, left: true });

    // Broadcast social:member_left to room channel (non-fatal if Redis unavailable)
    void broadcastService.emit(roomResult.Item['channelId'] as string, 'social:member_left', {
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
    const roomResult = await docClient.send(new GetCommand({
      TableName: ROOMS_TABLE,
      Key: { roomId: req.params.roomId },
    }));
    if (!roomResult.Item) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    // Check caller is a member (authorization gate)
    const callerMembership = await docClient.send(new GetCommand({
      TableName: ROOM_MEMBERS_TABLE,
      Key: { roomId: req.params.roomId, userId: req.user!.sub },
    }));
    if (!callerMembership.Item) {
      res.status(403).json({ error: 'You are not a member of this room' });
      return;
    }

    // Query all members of this room
    const membersResult = await docClient.send(new QueryCommand({
      TableName: ROOM_MEMBERS_TABLE,
      KeyConditionExpression: 'roomId = :rid',
      ExpressionAttributeValues: { ':rid': req.params.roomId },
    }));

    const members = (membersResult.Items ?? []).map(item => ({
      roomId: item['roomId'] as string,
      userId: item['userId'] as string,
      role: item['role'] as string,
      joinedAt: item['joinedAt'] as string,
    }));

    res.status(200).json({ members });
  } catch (err) {
    console.error('[room-members] GET /members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms — list all rooms the caller belongs to (ROOM-08)
// NOTE: Mounted as a separate top-level router at /rooms in index.ts
// roomMembersRouter (mergeParams: true) is mounted at /rooms/:roomId — it cannot handle /rooms (no roomId)
export const myRoomsRouter = Router();

myRoomsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // Step 1: Scan social-room-members for all rooms this user belongs to
    const membershipScan = await docClient.send(new ScanCommand({
      TableName: ROOM_MEMBERS_TABLE,
      FilterExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': req.user!.sub },
    }));
    const memberships = membershipScan.Items ?? [];
    const roomIds = memberships.map(m => m['roomId'] as string);

    if (roomIds.length === 0) {
      res.status(200).json({ rooms: [] });
      return;
    }

    // Step 2: BatchGetCommand to enrich with room details
    const batchResult = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [ROOMS_TABLE]: {
          Keys: roomIds.map(id => ({ roomId: id })),
        },
      },
    }));
    const rooms = (batchResult.Responses?.[ROOMS_TABLE] ?? []) as RoomItem[];

    // Step 3: Merge membership role into each room result
    const membershipMap = new Map(memberships.map(m => [m['roomId'] as string, m['role'] as string]));
    const result = rooms.map(room => ({
      ...room,
      role: membershipMap.get(room.roomId) ?? 'member',
    }));

    res.status(200).json({ rooms: result });
  } catch (err) {
    console.error('[room-members] GET /rooms error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
