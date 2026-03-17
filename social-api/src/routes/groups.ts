import { v4 as uuidv4 } from 'uuid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddb);
const GROUPS_TABLE = 'social-groups';
const MEMBERS_TABLE = 'social-group-members';

export const groupsRouter = Router();

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
  joinedAt: string;
}

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

    // Write group record
    await docClient.send(new PutCommand({
      TableName: GROUPS_TABLE,
      Item: groupItem,
    }));

    // Write owner membership record
    const memberItem: GroupMemberItem = {
      groupId,
      userId: callerId,
      role: 'owner',
      joinedAt: now,
    };

    await docClient.send(new PutCommand({
      TableName: MEMBERS_TABLE,
      Item: memberItem,
    }));

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

    // Fetch the group
    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group = groupResult.Item as GroupItem;

    // Check caller membership
    const memberResult = await docClient.send(new GetCommand({
      TableName: MEMBERS_TABLE,
      Key: { groupId, userId: callerId },
    }));

    const memberItem = memberResult.Item as GroupMemberItem | undefined;
    const isMember = memberItem !== undefined;

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

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group = groupResult.Item as GroupItem;

    if (group.ownerId !== callerId) {
      res.status(403).json({ error: 'Only the group owner can delete this group' });
      return;
    }

    await docClient.send(new DeleteCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

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

    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
    }));

    if (!groupResult.Item) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group = groupResult.Item as GroupItem;

    if (group.ownerId !== callerId) {
      res.status(403).json({ error: 'Only the group owner can change visibility' });
      return;
    }

    const result = await docClient.send(new UpdateCommand({
      TableName: GROUPS_TABLE,
      Key: { groupId },
      UpdateExpression: 'SET visibility = :v, updatedAt = :u',
      ExpressionAttributeValues: {
        ':v': visibility,
        ':u': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }));

    res.status(200).json(result.Attributes as GroupItem);
  } catch (err) {
    console.error('PATCH /groups/:groupId/visibility error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
