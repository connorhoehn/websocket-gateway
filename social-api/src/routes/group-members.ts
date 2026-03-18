import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient } from '../lib/aws-clients';
const GROUPS_TABLE = 'social-groups';
const MEMBERS_TABLE = 'social-group-members';

export const groupMembersRouter = Router({ mergeParams: true });

interface GroupItem {
  groupId: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface GroupMemberItem {
  groupId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  status: 'invited' | 'active';
  joinedAt: string;
  invitedAt?: string;
}

async function getCallerMembership(groupId: string, userId: string): Promise<GroupMemberItem | undefined> {
  const result = await docClient.send(new GetCommand({
    TableName: MEMBERS_TABLE,
    Key: { groupId, userId },
  }));
  return result.Item as GroupMemberItem | undefined;
}

// POST /api/groups/:groupId/invite — invite a user (GRUP-03)
groupMembersRouter.post('/invite', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;
    const { userId } = req.body as { userId?: string };

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    if (userId === callerId) {
      res.status(400).json({ error: 'Cannot invite yourself' });
      return;
    }

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const callerMembership = await getCallerMembership(groupId, callerId);

    if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
      res.status(403).json({ error: 'Only group owners and admins can invite members' });
      return;
    }

    const targetMembership = await getCallerMembership(groupId, userId);
    if (targetMembership && (targetMembership.status === 'active' || targetMembership.status === undefined)) {
      res.status(409).json({ error: 'User is already a member' });
      return;
    }

    await docClient.send(new PutCommand({
      TableName: MEMBERS_TABLE,
      Item: {
        groupId,
        userId,
        role: 'member',
        status: 'invited',
        invitedAt: new Date().toISOString(),
        joinedAt: '',
      },
    }));

    res.status(201).json({ groupId, userId, status: 'invited' });
  } catch (err) {
    console.error('POST /groups/:groupId/invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/groups/:groupId/invitations/:action — accept or decline an invitation (GRUP-04)
groupMembersRouter.post('/invitations/:action', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, action } = req.params;
    const callerId = req.user!.sub;

    if (action !== 'accept' && action !== 'decline') {
      res.status(400).json({ error: 'action must be accept or decline' });
      return;
    }

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const membership = await getCallerMembership(groupId, callerId);

    if (!membership || membership.status !== 'invited') {
      res.status(404).json({ error: 'No pending invitation found' });
      return;
    }

    if (action === 'accept') {
      await docClient.send(new UpdateCommand({
        TableName: MEMBERS_TABLE,
        Key: { groupId, userId: callerId },
        UpdateExpression: 'SET #s = :s, joinedAt = :j',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':s': 'active',
          ':j': new Date().toISOString(),
        },
      }));

      res.status(200).json({ message: 'Invitation accepted', groupId });
    } else {
      await docClient.send(new DeleteCommand({
        TableName: MEMBERS_TABLE,
        Key: { groupId, userId: callerId },
      }));

      res.status(200).json({ message: 'Invitation declined' });
    }
  } catch (err) {
    console.error('POST /groups/:groupId/invitations/:action error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/groups/:groupId/join — join a public group without invitation (GRUP-06)
groupMembersRouter.post('/join', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group = groupResult.Item as GroupItem;

    if (group.visibility === 'private') {
      res.status(403).json({ error: 'This group is private. You must be invited to join.' });
      return;
    }

    const existing = await getCallerMembership(groupId, callerId);
    if (existing && (existing.status === 'active' || existing.status === undefined)) {
      res.status(409).json({ error: 'Already a member of this group' });
      return;
    }

    await docClient.send(new PutCommand({
      TableName: MEMBERS_TABLE,
      Item: {
        groupId,
        userId: callerId,
        role: 'member',
        status: 'active',
        joinedAt: new Date().toISOString(),
      },
    }));

    res.status(201).json({ groupId, userId: callerId, role: 'member' });
  } catch (err) {
    console.error('POST /groups/:groupId/join error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/groups/:groupId/leave — leave a group (GRUP-07)
groupMembersRouter.delete('/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const membership = await getCallerMembership(groupId, callerId);

    if (!membership || membership.status === 'invited') {
      res.status(404).json({ error: 'You are not a member of this group' });
      return;
    }

    if (membership.role === 'owner') {
      res.status(403).json({ error: 'Group owner cannot leave. Transfer ownership or delete the group.' });
      return;
    }

    await docClient.send(new DeleteCommand({
      TableName: MEMBERS_TABLE,
      Key: { groupId, userId: callerId },
    }));

    res.status(200).json({ message: 'Left group successfully' });
  } catch (err) {
    console.error('DELETE /groups/:groupId/leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/groups/:groupId/members — list all members with roles (GRUP-08, GRUP-09)
groupMembersRouter.get('/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const callerId = req.user!.sub;

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group = groupResult.Item as GroupItem;

    const callerMembership = await getCallerMembership(groupId, callerId);
    const isActiveMember = callerMembership !== undefined &&
      (callerMembership.status === 'active' || callerMembership.status === undefined);

    if (group.visibility === 'private' && !isActiveMember) {
      res.status(403).json({ error: 'This group is private' });
      return;
    }

    const queryResult = await docClient.send(new QueryCommand({
      TableName: MEMBERS_TABLE,
      KeyConditionExpression: 'groupId = :gid',
      FilterExpression: '#s = :active OR attribute_not_exists(#s)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':gid': groupId,
        ':active': 'active',
      },
    }));

    const members = (queryResult.Items ?? []).map((item) => ({
      userId: item['userId'] as string,
      role: item['role'] as string,
      joinedAt: item['joinedAt'] as string,
    }));

    res.status(200).json({ members });
  } catch (err) {
    console.error('GET /groups/:groupId/members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
