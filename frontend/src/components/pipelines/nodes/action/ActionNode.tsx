// frontend/src/components/pipelines/nodes/action/ActionNode.tsx
//
// Action node — 1 input (`in`), 2 outputs (`out`, `error`). Subtitle is
// the action type; body is a one-line description derived from config.
// See PIPELINES_PLAN.md §5.5 / §18.4.4 / §19.12.

import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { ActionNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';

type ActionData = ActionNodeData & {
  _state?: NodeExecutionState;
} & Record<string, unknown>;

type ActionFlowNode = Node<ActionData, 'action'>;

function describe(data: ActionData): string {
  const cfg = data.config ?? {};
  switch (data.actionType) {
    case 'update-document': {
      const id = typeof cfg.documentId === 'string' ? cfg.documentId : '(current)';
      return `Update ${id}`;
    }
    case 'post-comment': {
      const target = typeof cfg.target === 'string' ? cfg.target : '(current doc)';
      return `Comment on ${target}`;
    }
    case 'notify': {
      const channel = typeof cfg.channel === 'string' ? cfg.channel : 'recipients';
      return `Notify ${channel}`;
    }
    case 'webhook': {
      const url = typeof cfg.url === 'string' ? cfg.url : '(no URL)';
      return `POST → ${url}`;
    }
    case 'mcp-tool': {
      const tool = typeof cfg.tool === 'string' ? cfg.tool : '(no tool)';
      return `Invoke ${tool}`;
    }
    default:
      return 'Action';
  }
}

export default function ActionNode(props: NodeProps<ActionFlowNode>) {
  const { data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  const inHandle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };
  const outHandle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10, top: '40%',
  };
  const errorHandle: CSSProperties = {
    background: colors.state.failed, width: 10, height: 10, top: '60%',
  };

  return (
    <BaseNode
      icon="⚡"
      subtitle={data.actionType}
      state={state}
      body={<span style={{ fontStyle: 'italic' }}>{describe(data)}</span>}
      selected={selected}
    >
      <Handle type="target" position={Position.Left}  id="in"    style={inHandle} />
      <Handle type="source" position={Position.Right} id="out"   style={outHandle} />
      <Handle type="source" position={Position.Right} id="error" style={errorHandle} />
    </BaseNode>
  );
}
