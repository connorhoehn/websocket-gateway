// frontend/src/components/pipelines/nodes/fork/ForkNode.tsx
//
// Fork node — 1 input (`in`), N outputs (`branch-0`…`branch-(N-1)`).
// Handles are stacked evenly by vertical percentage. Subtitle shows the
// branch count; body lists branch labels.
// See PIPELINES_PLAN.md §5.6 / §18.4.4 / §19.12.

import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { ForkNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';

type ForkData = ForkNodeData & {
  _state?: NodeExecutionState;
} & Record<string, unknown>;

type ForkFlowNode = Node<ForkData, 'fork'>;

const BRANCH_HANDLE_COLOR = '#2563eb'; // blue per §18.4.4 handles spec

export default function ForkNode(props: NodeProps<ForkFlowNode>) {
  const { data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  const count = Math.max(2, Math.min(8, data.branchCount ?? 2));
  const labels: string[] = Array.from({ length: count }, (_, i) => {
    const custom = data.branchLabels?.[i];
    return custom && custom.trim().length > 0 ? custom : `branch ${i}`;
  });

  const inHandle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };

  const labelListStyle: CSSProperties = {
    margin: 0, padding: 0, listStyle: 'none',
    display: 'flex', flexDirection: 'column', gap: 2,
    fontSize: 12, color: colors.textSecondary,
  };

  const labelItemStyle: CSSProperties = {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };

  return (
    <BaseNode
      icon="⑂"
      subtitle={`${count} branches`}
      state={state}
      body={
        <ul style={labelListStyle}>
          {labels.map((label, i) => (
            <li key={i} style={labelItemStyle}>• {label}</li>
          ))}
        </ul>
      }
      selected={selected}
    >
      <Handle type="target" position={Position.Left} id="in" style={inHandle} />
      {labels.map((_label, i) => {
        // Evenly spaced in the vertical axis (leave 0% and 100% as margins).
        const pct = ((i + 1) / (count + 1)) * 100;
        const style: CSSProperties = {
          background: BRANCH_HANDLE_COLOR,
          width: 10, height: 10,
          top: `${pct}%`,
        };
        return (
          <Handle
            key={i}
            type="source"
            position={Position.Right}
            id={`branch-${i}`}
            style={style}
          />
        );
      })}
    </BaseNode>
  );
}
