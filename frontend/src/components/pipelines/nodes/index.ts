// frontend/src/components/pipelines/nodes/index.ts
//
// Registry of React Flow node components for the pipeline editor canvas.
// Consumed by the editor via `<ReactFlow nodeTypes={nodeTypes} />`.

import TriggerNode from './trigger/TriggerNode';
import LLMNode from './llm/LLMNode';
import TransformNode from './transform/TransformNode';
import ConditionNode from './condition/ConditionNode';
import ActionNode from './action/ActionNode';
import ForkNode from './fork/ForkNode';
import JoinNode from './join/JoinNode';
import ApprovalNode from './approval/ApprovalNode';

export {
  TriggerNode,
  LLMNode,
  TransformNode,
  ConditionNode,
  ActionNode,
  ForkNode,
  JoinNode,
  ApprovalNode,
};

export { default as BaseNode, type NodeExecutionState } from './BaseNode';

export const nodeTypes = {
  trigger:   TriggerNode,
  llm:       LLMNode,
  transform: TransformNode,
  condition: ConditionNode,
  action:    ActionNode,
  fork:      ForkNode,
  join:      JoinNode,
  approval:  ApprovalNode,
} as const;
