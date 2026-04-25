// frontend/src/components/pipelines/nodes/condition/ConditionNode.tsx
//
// Condition node — 1 input (`in`), 2 outputs (`true` green, `false` orange).
// Subtitle = label or 'condition'; body shows the expression snippet.
// See PIPELINES_PLAN.md §5.4 / §18.4.4 / §19.12.

import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { ConditionNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';
import { useRetryFromStep } from '../../context/PipelineRunsContext';

type ConditionData = ConditionNodeData & {
  _state?: NodeExecutionState;
} & Record<string, unknown>;

type ConditionFlowNode = Node<ConditionData, 'condition'>;

function snippet(expr: string): string {
  if (!expr) return '—';
  const flat = expr.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

export default function ConditionNode(props: NodeProps<ConditionFlowNode>) {
  const { id, data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  // §17.6 retry-from-here — see TriggerNode for the rationale.
  const retry = useRetryFromStep();
  const onRetry = state === 'failed' ? () => retry(id) : undefined;

  const exprStyle: CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    color: colors.textPrimary,
    background: colors.surfaceInset,
    padding: '2px 6px',
    borderRadius: 4,
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const inHandle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };
  const trueHandle: CSSProperties = {
    background: colors.state.completed, width: 10, height: 10, top: '40%',
  };
  const falseHandle: CSSProperties = {
    background: colors.state.awaiting, width: 10, height: 10, top: '60%',
  };

  return (
    <BaseNode
      icon="❓"
      subtitle={data.label || 'condition'}
      state={state}
      body={<span style={exprStyle}>{snippet(data.expression)}</span>}
      selected={selected}
      onRetry={onRetry}
    >
      <Handle type="target" position={Position.Left}  id="in"    style={inHandle} />
      <Handle type="source" position={Position.Right} id="true"  style={trueHandle} />
      <Handle type="source" position={Position.Right} id="false" style={falseHandle} />
    </BaseNode>
  );
}
