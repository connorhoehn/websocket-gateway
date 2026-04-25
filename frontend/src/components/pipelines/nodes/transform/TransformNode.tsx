// frontend/src/components/pipelines/nodes/transform/TransformNode.tsx
//
// Transform node — 1 input (`in`), 1 output (`out`). Subtitle is the
// transform type; body shows a truncated mono-font expression snippet.
// See PIPELINES_PLAN.md §5.3 / §18.4.4 / §19.12.

import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { TransformNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';

type TransformData = TransformNodeData & {
  _state?: NodeExecutionState;
} & Record<string, unknown>;

type TransformFlowNode = Node<TransformData, 'transform'>;

function snippet(expr: string): string {
  if (!expr) return '—';
  const flat = expr.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

export default function TransformNode(props: NodeProps<TransformFlowNode>) {
  const { data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

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

  const handleStyle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };

  return (
    <BaseNode
      icon="✨"
      subtitle={data.transformType}
      state={state}
      body={<span style={exprStyle}>{snippet(data.expression)}</span>}
      selected={selected}
    >
      <Handle type="target" position={Position.Left}  id="in"  style={handleStyle} />
      <Handle type="source" position={Position.Right} id="out" style={handleStyle} />
    </BaseNode>
  );
}
