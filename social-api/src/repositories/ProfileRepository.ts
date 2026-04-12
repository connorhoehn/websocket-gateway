import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from './BaseRepository';

export interface ProfileItem {
  userId: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}

export class ProfileRepository extends BaseRepository {
  constructor(docClient: DynamoDBDocumentClient) {
    super('social-profiles', docClient);
  }

  async getProfile(userId: string): Promise<ProfileItem | null> {
    return this.getItem<ProfileItem>({ userId });
  }

  async createProfile(item: ProfileItem): Promise<void> {
    return this.putItem(item as unknown as Record<string, unknown>);
  }

  async updateProfile(
    userId: string,
    updates: Partial<Pick<ProfileItem, 'displayName' | 'bio' | 'avatarUrl' | 'visibility'>>,
  ): Promise<ProfileItem> {
    const expressions: string[] = [];
    const exprValues: Record<string, unknown> = {};

    if (updates.displayName !== undefined) {
      expressions.push('displayName = :displayName');
      exprValues[':displayName'] = updates.displayName;
    }
    if (updates.bio !== undefined) {
      expressions.push('bio = :bio');
      exprValues[':bio'] = updates.bio;
    }
    if (updates.avatarUrl !== undefined) {
      expressions.push('avatarUrl = :avatarUrl');
      exprValues[':avatarUrl'] = updates.avatarUrl;
    }
    if (updates.visibility !== undefined) {
      expressions.push('visibility = :visibility');
      exprValues[':visibility'] = updates.visibility;
    }

    const now = new Date().toISOString();
    expressions.push('updatedAt = :updatedAt');
    exprValues[':updatedAt'] = now;

    const result = await this.updateItem({
      Key: { userId },
      UpdateExpression: 'SET ' + expressions.join(', '),
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    });

    return result as unknown as ProfileItem;
  }

  async batchGetProfiles(userIds: string[]): Promise<ProfileItem[]> {
    if (userIds.length === 0) return [];

    // Use BatchGetCommand directly for multi-key lookups
    const { BatchGetCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await this.docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: userIds.map((uid) => ({ userId: uid })),
          },
        },
      }),
    );

    return (result.Responses?.[this.tableName] ?? []) as ProfileItem[];
  }
}
