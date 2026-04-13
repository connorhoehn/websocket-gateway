// frontend/src/components/doc-editor/WorkflowPanel.tsx
//
// Slide-out sidebar for managing approval workflows on a document.

import { useState, useCallback } from 'react';
import type { GatewayMessage } from '../../types/gateway';
import { useWorkflows, type ApprovalWorkflow, type WorkflowStep } from '../../hooks/useWorkflows';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkflowPanelProps {
  documentId: string;
  userId: string;
  idToken: string | null;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: GatewayMessage) => void) => () => void;
  connectionState: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  width: 360,
  height: '100%',
  background: '#fff',
  borderLeft: '1px solid #e5e7eb',
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid #e5e7eb',
  flexShrink: 0,
};

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  color: '#374151',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#3b82f6',
  color: '#fff',
  border: '1px solid #3b82f6',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#dbeafe', fg: '#1e40af' },
    completed: { bg: '#dcfce7', fg: '#166534' },
    rejected: { bg: '#fef2f2', fg: '#991b1b' },
    cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
    pending: { bg: '#fefce8', fg: '#854d0e' },
    approved: { bg: '#dcfce7', fg: '#166534' },
    skipped: { bg: '#f3f4f6', fg: '#6b7280' },
  };
  const { bg, fg } = colors[status] ?? colors.pending;
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      background: bg,
      color: fg,
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function StepProgress({ steps }: { steps: WorkflowStep[] }) {
  const completed = steps.filter(s => s.status === 'approved' || s.status === 'skipped').length;
  const pct = steps.length > 0 ? (completed / steps.length) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <div style={{ flex: 1, height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#3b82f6', borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{completed}/{steps.length}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Workflow Form
// ---------------------------------------------------------------------------

function CreateWorkflowForm({ onCreate, onCancel }: {
  onCreate: (name: string, type: 'sequential' | 'parallel' | 'any', steps: Array<{ name: string; requiredApprovers: Array<{ userId: string }> }>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'sequential' | 'parallel' | 'any'>('sequential');
  const [steps, setSteps] = useState([{ name: '', approverIds: '' }]);

  const addStep = () => setSteps(prev => [...prev, { name: '', approverIds: '' }]);
  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx));
  const updateStep = (idx: number, field: 'name' | 'approverIds', value: string) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSubmit = () => {
    if (!name.trim() || steps.length === 0) return;
    const formattedSteps = steps
      .filter(s => s.name.trim())
      .map(s => ({
        name: s.name.trim(),
        requiredApprovers: s.approverIds
          .split(',')
          .map(id => id.trim())
          .filter(Boolean)
          .map(userId => ({ userId })),
      }));
    if (formattedSteps.length === 0) return;
    onCreate(name.trim(), type, formattedSteps);
  };

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 10 }}>New Workflow</div>

      <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Name</label>
      <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Final Review" />

      <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginTop: 10, marginBottom: 4 }}>Type</label>
      <select style={selectStyle} value={type} onChange={e => setType(e.target.value as typeof type)}>
        <option value="sequential">Sequential (one at a time)</option>
        <option value="parallel">Parallel (all must approve)</option>
        <option value="any">Any (N of M)</option>
      </select>

      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10, marginBottom: 6 }}>Steps</div>
      {steps.map((step, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={step.name}
            onChange={e => updateStep(idx, 'name', e.target.value)}
            placeholder={`Step ${idx + 1} name`}
          />
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={step.approverIds}
            onChange={e => updateStep(idx, 'approverIds', e.target.value)}
            placeholder="user1, user2"
          />
          {steps.length > 1 && (
            <button type="button" onClick={() => removeStep(idx)} style={{ ...btnStyle, padding: '4px 8px', fontSize: 12 }}>x</button>
          )}
        </div>
      ))}
      <button type="button" onClick={addStep} style={{ ...btnStyle, fontSize: 12, marginBottom: 10 }}>+ Add Step</button>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
        <button type="button" onClick={handleSubmit} style={primaryBtnStyle}>Create</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow Detail View
// ---------------------------------------------------------------------------

function WorkflowDetail({ workflow, userId, onAdvance, onBack }: {
  workflow: ApprovalWorkflow;
  userId: string;
  onAdvance: (action: 'approve' | 'reject' | 'skip') => void;
  onBack: () => void;
}) {
  const currentStep = workflow.steps[workflow.currentStepIndex];
  const isActive = workflow.workflowStatus === 'active';
  const isPendingApprover = isActive && currentStep?.status === 'pending' &&
    currentStep.requiredApprovers.some(a => a.userId === userId) &&
    !currentStep.approvals?.some(a => a.userId === userId);

  return (
    <div style={{ padding: '12px 16px' }}>
      <button type="button" onClick={onBack} style={{ ...btnStyle, fontSize: 12, marginBottom: 10 }}>Back</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{workflow.name}</div>
        <StatusBadge status={workflow.workflowStatus} />
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
        Type: {workflow.type} &middot; Created {new Date(workflow.createdAt).toLocaleDateString()}
      </div>

      <StepProgress steps={workflow.steps} />

      <div style={{ marginTop: 16 }}>
        {workflow.steps.map((step, idx) => (
          <div key={idx} style={{
            padding: '10px 12px',
            marginBottom: 6,
            borderRadius: 6,
            border: idx === workflow.currentStepIndex && isActive ? '2px solid #3b82f6' : '1px solid #e5e7eb',
            background: idx === workflow.currentStepIndex && isActive ? '#f0f7ff' : '#fafafa',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{step.name}</span>
              <StatusBadge status={step.status} />
            </div>

            {step.requiredApprovers.length > 0 && (
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                Approvers: {step.requiredApprovers.map(a => a.userId ?? a.groupId ?? a.role ?? '?').join(', ')}
              </div>
            )}

            {step.approvals && step.approvals.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {step.approvals.map((a, ai) => (
                  <div key={ai} style={{ fontSize: 11, color: a.action === 'approve' ? '#166534' : a.action === 'reject' ? '#991b1b' : '#6b7280' }}>
                    {a.userId?.slice(0, 12)} {a.action}d{a.comment ? ` — "${a.comment}"` : ''}
                  </div>
                ))}
              </div>
            )}

            {step.completedBy && (
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                Completed by {step.completedBy.slice(0, 12)} at {new Date(step.completedAt ?? '').toLocaleString()}
              </div>
            )}
          </div>
        ))}
      </div>

      {isPendingApprover && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
          <button type="button" onClick={() => onAdvance('approve')} style={{ ...primaryBtnStyle, background: '#16a34a', borderColor: '#16a34a' }}>
            Approve
          </button>
          <button type="button" onClick={() => onAdvance('reject')} style={{ ...btnStyle, color: '#dc2626', borderColor: '#dc2626' }}>
            Reject
          </button>
          <button type="button" onClick={() => onAdvance('skip')} style={btnStyle}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function WorkflowPanel({
  documentId,
  userId,
  idToken,
  sendMessage,
  onMessage,
  connectionState,
  onClose,
}: WorkflowPanelProps) {
  const { workflows, createWorkflow, advanceWorkflow, loading } = useWorkflows({
    documentId,
    idToken,
    sendMessage,
    onMessage,
    connectionState,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const selectedWorkflow = workflows.find(w => w.workflowId === selectedWorkflowId) ?? null;

  const handleCreate = useCallback(async (
    name: string,
    type: 'sequential' | 'parallel' | 'any',
    steps: Array<{ name: string; requiredApprovers: Array<{ userId: string }> }>,
  ) => {
    try {
      await createWorkflow(name, type, steps);
      setShowCreate(false);
    } catch (err) {
      console.error('[WorkflowPanel] create error:', err);
    }
  }, [createWorkflow]);

  const handleAdvance = useCallback(async (action: 'approve' | 'reject' | 'skip') => {
    if (!selectedWorkflowId) return;
    try {
      await advanceWorkflow(selectedWorkflowId, action);
    } catch (err) {
      console.error('[WorkflowPanel] advance error:', err);
    }
  }, [selectedWorkflowId, advanceWorkflow]);

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: 0 }}>Workflows</h3>
        <button type="button" onClick={onClose} style={btnStyle}>Close</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Detail view */}
        {selectedWorkflow && !showCreate && (
          <WorkflowDetail
            workflow={selectedWorkflow}
            userId={userId}
            onAdvance={handleAdvance}
            onBack={() => setSelectedWorkflowId(null)}
          />
        )}

        {/* Create form */}
        {showCreate && !selectedWorkflow && (
          <CreateWorkflowForm
            onCreate={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Workflow list */}
        {!selectedWorkflow && !showCreate && (
          <div style={{ padding: '12px 16px' }}>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              style={{ ...primaryBtnStyle, width: '100%', marginBottom: 12 }}
            >
              + New Workflow
            </button>

            {loading && <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', padding: 20 }}>Loading...</div>}

            {!loading && workflows.length === 0 && (
              <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 20 }}>
                No workflows yet. Create one to start an approval process.
              </div>
            )}

            {workflows.map(wf => (
              <button
                key={wf.workflowId}
                type="button"
                onClick={() => setSelectedWorkflowId(wf.workflowId)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  marginBottom: 6,
                  borderRadius: 6,
                  border: '1px solid #e5e7eb',
                  background: '#fafafa',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{wf.name}</span>
                  <StatusBadge status={wf.workflowStatus} />
                </div>
                <StepProgress steps={wf.steps} />
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  {wf.type} &middot; {wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
