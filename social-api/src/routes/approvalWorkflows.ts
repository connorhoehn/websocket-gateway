import { ulid } from 'ulid';
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { broadcastService } from '../services/broadcast';
import { approvalWorkflowRepo } from '../repositories';
import { WorkflowEngine } from '../services/WorkflowEngine';
import { WorkflowStep, ApprovalWorkflow } from '../repositories/ApprovalWorkflowRepository';

const engine = new WorkflowEngine(approvalWorkflowRepo);

// approvalWorkflowsRouter is mounted at /documents/:documentId/workflows
export const approvalWorkflowsRouter = Router({ mergeParams: true });

// pendingWorkflowsRouter is mounted at /workflows/pending
export const pendingWorkflowsRouter = Router();

// POST /api/documents/:documentId/workflows — create an approval workflow
approvalWorkflowsRouter.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { documentId } = req.params;
    const { name, type, steps } = req.body as {
      name?: string;
      type?: 'sequential' | 'parallel' | 'any';
      steps?: WorkflowStep[];
    };
    const createdBy = req.user!.sub;

    if (!name || !type || !steps || !Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({ error: 'name, type, and steps[] are required' });
      return;
    }

    const validTypes = ['sequential', 'parallel', 'any'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const now = new Date().toISOString();
    const workflowId = ulid();

    // Initialize step statuses
    const initializedSteps: WorkflowStep[] = steps.map((s) => ({
      name: s.name,
      status: 'pending' as const,
      requiredApprovers: s.requiredApprovers ?? [],
      requiredCount: s.requiredCount,
      approvals: [],
    }));

    const workflow: ApprovalWorkflow = {
      documentId,
      workflowId,
      name,
      type,
      steps: initializedSteps,
      currentStepIndex: 0,
      workflowStatus: 'active',
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await approvalWorkflowRepo.createWorkflow(workflow);

    res.status(201).json({ workflow });
  } catch (err) {
    console.error('[approvalWorkflows] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/documents/:documentId/workflows — list workflows for a document
approvalWorkflowsRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { documentId } = req.params;
    const workflows = await approvalWorkflowRepo.getWorkflowsForDocument(documentId);
    res.status(200).json({ workflows });
  } catch (err) {
    console.error('[approvalWorkflows] GET / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/documents/:documentId/workflows/:workflowId — get workflow with progress
approvalWorkflowsRouter.get('/:workflowId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { documentId, workflowId } = req.params;

    const workflow = await approvalWorkflowRepo.getWorkflow(documentId, workflowId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const progress = await engine.getWorkflowProgress(documentId, workflowId);

    res.status(200).json({ workflow, progress });
  } catch (err) {
    console.error('[approvalWorkflows] GET /:workflowId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/documents/:documentId/workflows/:workflowId/advance — approve/reject/skip current step
approvalWorkflowsRouter.post('/:workflowId/advance', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { documentId, workflowId } = req.params;
    const { action, comment } = req.body as {
      action?: 'approve' | 'reject' | 'skip';
      comment?: string;
    };
    const userId = req.user!.sub;

    if (!action || !['approve', 'reject', 'skip'].includes(action)) {
      res.status(400).json({ error: 'action must be one of: approve, reject, skip' });
      return;
    }

    const result = await engine.advanceWorkflow(documentId, workflowId, userId, action, comment);

    // Broadcast workflow advanced event (non-fatal if Redis unavailable)
    const currentStep = result.workflow.steps[result.workflow.currentStepIndex];
    void broadcastService.emit(`doc:${documentId}`, 'doc:workflow_advanced', {
      type: 'doc:workflow_advanced',
      documentId,
      workflowId,
      step: currentStep?.name,
      action,
    });

    // Broadcast workflow completed event if finished
    if (result.completed) {
      void broadcastService.emit(`doc:${documentId}`, 'doc:workflow_completed', {
        type: 'doc:workflow_completed',
        documentId,
        workflowId,
      });
    }

    res.status(200).json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';

    // Return 404 for not-found, 409 for state conflicts, 403 for unauthorized approver
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('not active') || message.includes('not pending') || message.includes('already acted')) {
      res.status(409).json({ error: message });
      return;
    }
    if (message.includes('not a required approver')) {
      res.status(403).json({ error: message });
      return;
    }

    console.error('[approvalWorkflows] POST /:workflowId/advance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workflows/pending — get current user's pending approvals
pendingWorkflowsRouter.get('/pending', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.sub;
    const workflows = await approvalWorkflowRepo.getPendingForUser(userId);
    res.status(200).json({ workflows });
  } catch (err) {
    console.error('[approvalWorkflows] GET /pending error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
