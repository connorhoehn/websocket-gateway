import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Router, Request, Response } from 'express';
import { docClient } from '../lib/aws-clients';

const TABLE = 'user-activity';

export const activityRouter = Router();

// GET /api/activity — paginated activity log for authenticated user (ALOG-02)
activityRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const lastKey = req.query.lastKey as string | undefined;

    const exclusiveStartKey = lastKey
      ? JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8'))
      : undefined;

    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,  // newest first
      Limit: limit,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }));

    const items = (result.Items ?? []).map(item => ({
      eventType: item.eventType,
      timestamp: (item.timestamp as string).split('#')[0],  // strip eventId suffix
      detail: JSON.parse(item.detail as string),
    }));

    const nextKey = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    res.json({ items, nextKey });
  } catch (err) {
    console.error('[activity] Failed to query activity log:', err);
    res.status(500).json({ error: 'Failed to load activity log' });
  }
});
