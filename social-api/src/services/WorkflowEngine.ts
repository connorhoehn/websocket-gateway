import {
  ApprovalWorkflowRepository,
  ApprovalWorkflow,
  WorkflowStep,
} from '../repositories/ApprovalWorkflowRepository';
import { GroupRepository } from '../repositories/GroupRepository';

export interface WorkflowAdvanceResult {
  workflow: ApprovalWorkflow;
  advanced: boolean;
  completed: boolean;
}

export interface WorkflowProgress {
  totalSteps: number;
  completedSteps: number;
  currentStep: WorkflowStep | null;
  pendingApprovers: Array<{ userId?: string; groupId?: string; role?: string }>;
}

export class WorkflowEngine {
  constructor(
    private repo: ApprovalWorkflowRepository,
    private groupRepo?: GroupRepository,
  ) {}

  /**
   * Advance a workflow by recording a user's action on the current step.
   *
   * Flow logic per workflow type:
   * - sequential: one approver decides; approve advances to next step, reject rejects workflow
   * - parallel: all required approvers must approve; any rejection rejects workflow
   * - any: N of M approvals needed (N = step.requiredCount, defaults to 1)
   */
  async advanceWorkflow(
    documentId: string,
    workflowId: string,
    userId: string,
    action: 'approve' | 'reject' | 'skip',
    comment?: string,
  ): Promise<WorkflowAdvanceResult> {
    const workflow = await this.repo.getWorkflow(documentId, workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${documentId}/${workflowId}`);
    }
    if (workflow.workflowStatus !== 'active') {
      throw new Error(`Workflow is not active (status: ${workflow.workflowStatus})`);
    }

    const stepIndex = workflow.currentStepIndex;
    const step = workflow.steps[stepIndex];
    if (!step || step.status !== 'pending') {
      throw new Error('Current step is not pending');
    }

    // Validate that user can approve this step
    const canApprove = await this.isUserApproverForStep(step, userId);
    if (!canApprove) {
      throw new Error(`User ${userId} is not a required approver for step "${step.name}"`);
    }

    const now = new Date().toISOString();
    const approvalRecord = { userId, action, comment, timestamp: now };

    // Initialize approvals array if needed
    if (!step.approvals) {
      step.approvals = [];
    }

    // Prevent duplicate approvals
    if (step.approvals.some((a) => a.userId === userId)) {
      throw new Error(`User ${userId} has already acted on step "${step.name}"`);
    }

    step.approvals.push(approvalRecord);

    let advanced = false;
    let completed = false;

    switch (workflow.type) {
      case 'sequential':
        ({ advanced, completed } = this.handleSequential(workflow, step, stepIndex, action, userId, now, comment));
        break;

      case 'parallel':
        ({ advanced, completed } = this.handleParallel(workflow, step, stepIndex, action, userId, now, comment));
        break;

      case 'any':
        ({ advanced, completed } = this.handleAny(workflow, step, stepIndex, action, userId, now, comment));
        break;
    }

    workflow.updatedAt = now;

    // Persist the full workflow state
    await this.repo.saveWorkflow(workflow);

    return { workflow, advanced, completed };
  }

  /**
   * Check if a user can approve the current step of a workflow.
   */
  async canUserApprove(documentId: string, workflowId: string, userId: string): Promise<boolean> {
    const workflow = await this.repo.getWorkflow(documentId, workflowId);
    if (!workflow || workflow.workflowStatus !== 'active') return false;

    const step = workflow.steps[workflow.currentStepIndex];
    if (!step || step.status !== 'pending') return false;

    // Check if already acted
    if (step.approvals?.some((a) => a.userId === userId)) return false;

    return this.isUserApproverForStep(step, userId);
  }

  /**
   * Get progress information for a workflow.
   */
  async getWorkflowProgress(documentId: string, workflowId: string): Promise<WorkflowProgress> {
    const workflow = await this.repo.getWorkflow(documentId, workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${documentId}/${workflowId}`);
    }

    const completedSteps = workflow.steps.filter(
      (s) => s.status === 'approved' || s.status === 'skipped',
    ).length;

    const currentStep =
      workflow.workflowStatus === 'active'
        ? workflow.steps[workflow.currentStepIndex] ?? null
        : null;

    // Determine pending approvers: those in requiredApprovers who haven't acted yet
    let pendingApprovers: WorkflowProgress['pendingApprovers'] = [];
    if (currentStep && currentStep.status === 'pending') {
      const actedUserIds = new Set((currentStep.approvals ?? []).map((a) => a.userId));
      pendingApprovers = currentStep.requiredApprovers.filter(
        (a) => !a.userId || !actedUserIds.has(a.userId),
      );
    }

    return {
      totalSteps: workflow.steps.length,
      completedSteps,
      currentStep,
      pendingApprovers,
    };
  }

  // --- Private helpers ---

  private handleSequential(
    workflow: ApprovalWorkflow,
    step: WorkflowStep,
    stepIndex: number,
    action: 'approve' | 'reject' | 'skip',
    userId: string,
    now: string,
    comment?: string,
  ): { advanced: boolean; completed: boolean } {
    if (action === 'reject') {
      step.status = 'rejected';
      step.completedBy = userId;
      step.completedAt = now;
      step.comment = comment;
      workflow.workflowStatus = 'rejected';
      return { advanced: false, completed: false };
    }

    // approve or skip
    step.status = action === 'skip' ? 'skipped' : 'approved';
    step.completedBy = userId;
    step.completedAt = now;
    step.comment = comment;

    return this.tryAdvanceToNextStep(workflow, stepIndex);
  }

  private handleParallel(
    workflow: ApprovalWorkflow,
    step: WorkflowStep,
    stepIndex: number,
    action: 'approve' | 'reject' | 'skip',
    userId: string,
    now: string,
    comment?: string,
  ): { advanced: boolean; completed: boolean } {
    if (action === 'reject') {
      step.status = 'rejected';
      step.completedBy = userId;
      step.completedAt = now;
      step.comment = comment;
      workflow.workflowStatus = 'rejected';
      return { advanced: false, completed: false };
    }

    // Check if all required approvers (with userId) have now acted
    const requiredUserIds = step.requiredApprovers
      .filter((a) => a.userId)
      .map((a) => a.userId!);
    const actedUserIds = new Set((step.approvals ?? []).map((a) => a.userId));
    const allApproved = requiredUserIds.every((uid) => actedUserIds.has(uid));

    if (allApproved) {
      step.status = 'approved';
      step.completedBy = userId; // last approver
      step.completedAt = now;
      return this.tryAdvanceToNextStep(workflow, stepIndex);
    }

    // Not all approvers have acted yet
    return { advanced: false, completed: false };
  }

  private handleAny(
    workflow: ApprovalWorkflow,
    step: WorkflowStep,
    stepIndex: number,
    action: 'approve' | 'reject' | 'skip',
    userId: string,
    now: string,
    comment?: string,
  ): { advanced: boolean; completed: boolean } {
    const requiredCount = step.requiredCount ?? 1;
    const approvals = (step.approvals ?? []).filter((a) => a.action === 'approve');
    const rejections = (step.approvals ?? []).filter((a) => a.action === 'reject');
    const totalApprovers = step.requiredApprovers.length;

    // If enough approvals reached, step passes
    if (approvals.length >= requiredCount) {
      step.status = 'approved';
      step.completedBy = userId;
      step.completedAt = now;
      return this.tryAdvanceToNextStep(workflow, stepIndex);
    }

    // If too many rejections make it impossible to reach requiredCount
    const remaining = totalApprovers - (approvals.length + rejections.length);
    if (approvals.length + remaining < requiredCount) {
      step.status = 'rejected';
      step.completedBy = userId;
      step.completedAt = now;
      step.comment = comment;
      workflow.workflowStatus = 'rejected';
      return { advanced: false, completed: false };
    }

    // Still waiting for more votes
    return { advanced: false, completed: false };
  }

  private tryAdvanceToNextStep(
    workflow: ApprovalWorkflow,
    currentIndex: number,
  ): { advanced: boolean; completed: boolean } {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= workflow.steps.length) {
      // All steps complete
      workflow.workflowStatus = 'completed';
      return { advanced: true, completed: true };
    }

    workflow.currentStepIndex = nextIndex;
    return { advanced: true, completed: false };
  }

  /**
   * Check if userId matches any required approver in the step.
   * Handles direct userId match and group membership lookup.
   */
  private async isUserApproverForStep(step: WorkflowStep, userId: string): Promise<boolean> {
    for (const approver of step.requiredApprovers) {
      // Direct user match
      if (approver.userId && approver.userId === userId) {
        return true;
      }

      // Group membership check
      if (approver.groupId && this.groupRepo) {
        const membership = await this.groupRepo.getMembership(approver.groupId, userId);
        if (membership) {
          return true;
        }
      }

      // Role-based match (group membership with specific role)
      if (approver.role && approver.groupId && this.groupRepo) {
        const membership = await this.groupRepo.getMembership(approver.groupId, userId);
        if (membership && membership.role === approver.role) {
          return true;
        }
      }
    }

    return false;
  }
}
