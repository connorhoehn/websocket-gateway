import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from './BaseRepository';

export interface WorkflowApprover {
  userId?: string;
  groupId?: string;
  role?: string;
}

export interface WorkflowStep {
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  requiredApprovers: WorkflowApprover[];
  completedBy?: string;
  completedAt?: string;
  comment?: string;
  /** For 'any' type workflows: how many approvals needed (defaults to 1) */
  requiredCount?: number;
  /** Track individual approvals for parallel/any flows */
  approvals?: Array<{ userId: string; action: 'approve' | 'reject' | 'skip'; comment?: string; timestamp: string }>;
}

export interface ApprovalWorkflow {
  documentId: string;
  workflowId: string;
  name: string;
  type: 'sequential' | 'parallel' | 'any';
  steps: WorkflowStep[];
  currentStepIndex: number;
  workflowStatus: 'active' | 'completed' | 'cancelled' | 'rejected';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

const TABLE_NAME = 'approval-workflows';

export class ApprovalWorkflowRepository {
  private base: BaseRepository;

  constructor(private docClient: DynamoDBDocumentClient) {
    this.base = new BaseRepository(TABLE_NAME, docClient);
  }

  async createWorkflow(workflow: ApprovalWorkflow): Promise<void> {
    await this.base.putItemConditional(
      workflow as unknown as Record<string, unknown>,
      'attribute_not_exists(documentId) AND attribute_not_exists(workflowId)',
    );
  }

  async getWorkflowsForDocument(documentId: string): Promise<ApprovalWorkflow[]> {
    return this.base.query<ApprovalWorkflow>({
      KeyConditionExpression: 'documentId = :did',
      ExpressionAttributeValues: { ':did': documentId },
    });
  }

  async getWorkflow(documentId: string, workflowId: string): Promise<ApprovalWorkflow | null> {
    return this.base.getItem<ApprovalWorkflow>({ documentId, workflowId });
  }

  async updateWorkflowStep(
    documentId: string,
    workflowId: string,
    stepIndex: number,
    update: Partial<WorkflowStep>,
  ): Promise<ApprovalWorkflow | undefined> {
    // Build SET expressions for each field in the step update
    const exprParts: string[] = ['updatedAt = :now'];
    const exprValues: Record<string, unknown> = {
      ':now': new Date().toISOString(),
    };
    const exprNames: Record<string, string> = {};

    for (const [key, value] of Object.entries(update)) {
      const attrPlaceholder = `:step_${key}`;
      exprParts.push(`steps[${stepIndex}].#${key} = ${attrPlaceholder}`);
      exprValues[attrPlaceholder] = value;
      exprNames[`#${key}`] = key;
    }

    const result = await this.base.updateItem({
      Key: { documentId, workflowId },
      UpdateExpression: `SET ${exprParts.join(', ')}`,
      ExpressionAttributeValues: exprValues,
      ExpressionAttributeNames: exprNames,
      ReturnValues: 'ALL_NEW',
    });
    return result as unknown as ApprovalWorkflow | undefined;
  }

  async updateWorkflowStatus(
    documentId: string,
    workflowId: string,
    status: ApprovalWorkflow['workflowStatus'],
    currentStepIndex?: number,
  ): Promise<ApprovalWorkflow | undefined> {
    let updateExpr = 'SET workflowStatus = :s, updatedAt = :now';
    const exprValues: Record<string, unknown> = {
      ':s': status,
      ':now': new Date().toISOString(),
    };

    if (currentStepIndex !== undefined) {
      updateExpr += ', currentStepIndex = :idx';
      exprValues[':idx'] = currentStepIndex;
    }

    const result = await this.base.updateItem({
      Key: { documentId, workflowId },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    });
    return result as unknown as ApprovalWorkflow | undefined;
  }

  async getActiveWorkflows(): Promise<ApprovalWorkflow[]> {
    return this.base.query<ApprovalWorkflow>({
      IndexName: 'status-index',
      KeyConditionExpression: 'workflowStatus = :s',
      ExpressionAttributeValues: { ':s': 'active' },
    });
  }

  async getPendingForUser(userId: string): Promise<ApprovalWorkflow[]> {
    // Scan active workflows and filter for steps where user is a required approver.
    // For small-to-medium scale this is acceptable; at scale, consider a GSI on userId.
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'workflowStatus = :active',
        ExpressionAttributeValues: { ':active': 'active' },
      }),
    );

    const workflows = (result.Items ?? []) as unknown as ApprovalWorkflow[];
    return workflows.filter((wf) => {
      const currentStep = wf.steps[wf.currentStepIndex];
      if (!currentStep || currentStep.status !== 'pending') return false;
      return currentStep.requiredApprovers.some((a) => a.userId === userId);
    });
  }

  /** Save the full workflow (overwrite). Used by WorkflowEngine after complex mutations. */
  async saveWorkflow(workflow: ApprovalWorkflow): Promise<void> {
    await this.base.putItem(workflow as unknown as Record<string, unknown>);
  }
}
