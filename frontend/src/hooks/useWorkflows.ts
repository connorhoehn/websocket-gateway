// frontend/src/hooks/useWorkflows.ts
//
// REST + WebSocket hook for document approval workflows.
// Fetches initial state from social-api and applies real-time updates
// via the document-events WS service.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GatewayMessage } from '../types/gateway';
import { SOCIAL_API_URL } from '../utils/socialApi';

// ---------------------------------------------------------------------------
// Types (mirror backend ApprovalWorkflow / WorkflowStep)
// ---------------------------------------------------------------------------

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
  requiredCount?: number;
  approvals?: Array<{
    userId: string;
    action: 'approve' | 'reject' | 'skip';
    comment?: string;
    timestamp: string;
  }>;
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
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseWorkflowsOptions {
  documentId: string;
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: string;
}

export interface UseWorkflowsReturn {
  workflows: ApprovalWorkflow[];
  createWorkflow: (
    name: string,
    type: 'sequential' | 'parallel' | 'any',
    steps: Array<{ name: string; requiredApprovers: WorkflowApprover[]; requiredCount?: number }>,
  ) => Promise<void>;
  advanceWorkflow: (
    workflowId: string,
    action: 'approve' | 'reject' | 'skip',
    comment?: string,
  ) => Promise<void>;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkflows(options: UseWorkflowsOptions): UseWorkflowsReturn {
  const { documentId, idToken, sendMessage, onMessage, connectionState } = options;

  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const documentIdRef = useRef(documentId);
  useEffect(() => { documentIdRef.current = documentId; }, [documentId]);

  const authHeaders = useMemo(() => {
    if (!idToken) return {};
    return {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    };
  }, [idToken]);

  // ---- Fetch workflows on mount / documentId change -----------------------
  const fetchWorkflows = useCallback(async () => {
    if (!documentId || !idToken) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentId}/workflows`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      );
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
      const data = (await res.json()) as { workflows: ApprovalWorkflow[] };
      setWorkflows(data.workflows ?? []);
    } catch (err) {
      console.warn('[useWorkflows] fetch error:', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [documentId, idToken]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // NOTE: document-events subscription is managed centrally by DocumentEditorPage,
  // not by individual hooks. This avoids one hook's cleanup unsubscribing all hooks.

  // ---- WebSocket message handler ------------------------------------------
  useEffect(() => {
    const unregister = onMessage((msg: GatewayMessage) => {
      const eventType = msg.type;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return;
      const msgDocId = payload.documentId as string | undefined;
      if (msgDocId && msgDocId !== documentIdRef.current) return;

      if (eventType === 'doc:workflow_advanced' || eventType === 'doc:workflow_completed') {
        // Re-fetch to get the updated workflow state
        fetchWorkflows();
      }
    });
    return unregister;
  }, [onMessage, fetchWorkflows]);

  // ---- createWorkflow -----------------------------------------------------
  const createWorkflow = useCallback(
    async (
      name: string,
      type: 'sequential' | 'parallel' | 'any',
      steps: Array<{ name: string; requiredApprovers: WorkflowApprover[]; requiredCount?: number }>,
    ): Promise<void> => {
      if (!idToken) return;
      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/workflows`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ name, type, steps }),
        },
      );
      if (!res.ok) throw new Error(`Failed to create workflow (${res.status})`);
      const data = (await res.json()) as { workflow: ApprovalWorkflow };
      setWorkflows((prev) => [...prev, data.workflow]);
    },
    [idToken, authHeaders],
  );

  // ---- advanceWorkflow ----------------------------------------------------
  const advanceWorkflow = useCallback(
    async (workflowId: string, action: 'approve' | 'reject' | 'skip', comment?: string): Promise<void> => {
      if (!idToken) return;
      const res = await fetch(
        `${SOCIAL_API_URL}/api/documents/${documentIdRef.current}/workflows/${workflowId}/advance`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ action, ...(comment ? { comment } : {}) }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error: string };
        throw new Error(err.error);
      }
      // Re-fetch to sync state
      fetchWorkflows();
    },
    [idToken, authHeaders, fetchWorkflows],
  );

  return { workflows, createWorkflow, advanceWorkflow, loading };
}
