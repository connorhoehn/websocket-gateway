// frontend/src/components/pipelines/nodes/approval/ApprovalNode.tsx
//
// Approval node — 1 input (`in`), 2 outputs (`approved` green, `rejected` red).
// Subtitle: "{N} approver(s), {required}/{N} required".
// Body: approver chips (first 2, "+N more" if more).
// See PIPELINES_PLAN.md §5.8 / §18.4.4 / §19.12.

import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { ApprovalNodeData, Approver } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';
import { useRetryFromStep } from '../../context/PipelineRunsContext';

type ApprovalData = ApprovalNodeData & {
  _state?: NodeExecutionState;
} & Record<string, unknown>;

type ApprovalFlowNode = Node<ApprovalData, 'approval'>;

function approverLabel(a: Approver): string {
  return a.type === 'role' ? `@${a.value}` : a.value;
}

export default function ApprovalNode(props: NodeProps<ApprovalFlowNode>) {
  const { id, data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  // §17.6 retry-from-here — see TriggerNode for the rationale.
  const retry = useRetryFromStep();
  const onRetry = state === 'failed' ? () => retry(id) : undefined;

  const approvers = data.approvers ?? [];
  const total = approvers.length;
  const required = data.requiredCount ?? 0;
  const subtitle = `${total} approver${total === 1 ? '' : 's'}, ${required}/${total} required`;

  const chipsRowStyle: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', gap: 4,
  };

  const chipStyle: CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    background: colors.surfacePanel,
    color: colors.textSecondary,
    border: `1px solid ${colors.border}`,
    maxWidth: 120,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };

  const moreChipStyle: CSSProperties = {
    ...chipStyle,
    background: colors.surfaceInset,
    color: colors.textTertiary,
  };

  const firstTwo = approvers.slice(0, 2);
  const more = Math.max(0, approvers.length - 2);

  const inHandle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };
  const approvedHandle: CSSProperties = {
    background: colors.state.completed, width: 10, height: 10, top: '40%',
  };
  const rejectedHandle: CSSProperties = {
    background: colors.state.failed, width: 10, height: 10, top: '60%',
  };

  const body = approvers.length === 0
    ? <span style={{ fontStyle: 'italic', color: colors.textTertiary }}>No approvers</span>
    : (
      <div style={chipsRowStyle}>
        {firstTwo.map((a, i) => (
          <span key={i} style={chipStyle}>{approverLabel(a)}</span>
        ))}
        {more > 0 && <span style={moreChipStyle}>+{more} more</span>}
      </div>
    );

  return (
    <BaseNode
      icon="✋"
      subtitle={subtitle}
      state={state}
      body={body}
      selected={selected}
      onRetry={onRetry}
    >
      <Handle type="target" position={Position.Left}  id="in"       style={inHandle} />
      <Handle type="source" position={Position.Right} id="approved" style={approvedHandle} />
      <Handle type="source" position={Position.Right} id="rejected" style={rejectedHandle} />
    </BaseNode>
  );
}
