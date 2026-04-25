// frontend/src/components/pipelines/nodes/join/JoinNode.tsx
//
// Join node — N inputs (`in-0`…`in-(N-1)`), 1 output (`out`). The handle
// count is dynamically sized from the number of incoming edges (minimum 2).
// Subtitle describes the mode; body shows the merge strategy.
// See PIPELINES_PLAN.md §5.7 / §18.4.4 / §19.12.

import type { CSSProperties } from 'react';
import {
  Handle, Position, useNodeConnections,
  type NodeProps, type Node,
} from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { JoinNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';

type JoinData = JoinNodeData & {
  _state?: NodeExecutionState;
} & Record<string, unknown>;

type JoinFlowNode = Node<JoinData, 'join'>;

function modeSubtitle(data: JoinData): string {
  if (data.mode === 'all') return 'all';
  if (data.mode === 'any') return 'any';
  return `${data.n ?? 1} of many`;
}

function mergeLabel(strategy: JoinData['mergeStrategy']): string {
  switch (strategy) {
    case 'deep-merge':        return 'Deep merge';
    case 'array-collect':     return 'Array collect';
    case 'last-writer-wins':  return 'Last writer wins';
    default:                  return String(strategy);
  }
}

export default function JoinNode(props: NodeProps<JoinFlowNode>) {
  const { data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  // Count incoming connections. Always render at least 2 handles so the
  // node has a visible join-point even when unconnected; grow beyond the
  // connected count by 1 so there's always one empty landing slot.
  const incoming = useNodeConnections({ handleType: 'target' });
  const handleCount = Math.max(2, incoming.length + 1);

  const outHandle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };

  return (
    <BaseNode
      icon="⑃"
      subtitle={modeSubtitle(data)}
      state={state}
      body={<span style={{ fontStyle: 'italic' }}>{mergeLabel(data.mergeStrategy)}</span>}
      selected={selected}
    >
      {Array.from({ length: handleCount }, (_, i) => {
        const pct = ((i + 1) / (handleCount + 1)) * 100;
        const style: CSSProperties = {
          background: colors.borderEmphasis,
          width: 10, height: 10,
          top: `${pct}%`,
        };
        return (
          <Handle
            key={`in-${i}`}
            type="target"
            position={Position.Left}
            id={`in-${i}`}
            style={style}
          />
        );
      })}
      <Handle type="source" position={Position.Right} id="out" style={outHandle} />
    </BaseNode>
  );
}
