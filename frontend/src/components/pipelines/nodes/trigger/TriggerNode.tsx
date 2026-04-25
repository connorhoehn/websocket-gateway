// frontend/src/components/pipelines/nodes/trigger/TriggerNode.tsx
//
// Trigger node — 0 inputs, 1 output (`out`). Subtitle summarizes the
// trigger type; body shows the concrete details (cron, path, doc-type).
// See PIPELINES_PLAN.md §5.1 / §18.4.4 / §19.12.

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { TriggerNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';

// Some runs tag data with an ephemeral `_state` — use it if present.
// The `& Record<string, unknown>` intersection satisfies @xyflow/react's
// Node generic constraint, which interface-shaped data does not meet on its own.
type TriggerData = TriggerNodeData & { _state?: NodeExecutionState } & Record<string, unknown>;
type TriggerFlowNode = Node<TriggerData, 'trigger'>;

function subtitleFor(data: TriggerData): string {
  switch (data.triggerType) {
    case 'manual':              return 'Manual';
    case 'document.finalize':   return 'On doc.finalize';
    case 'document.comment':    return 'On doc.comment';
    case 'document.submit':     return 'On doc.submit';
    case 'schedule':            return `Schedule: ${data.schedule ?? '—'}`;
    case 'webhook':             return `Webhook: ${data.webhookPath ?? '/—'}`;
    default:                    return 'Trigger';
  }
}

function bodyFor(data: TriggerData): string {
  if (data.triggerType === 'schedule') return data.schedule ? `cron: ${data.schedule}` : 'No schedule set';
  if (data.triggerType === 'webhook')  return data.webhookPath ? `POST ${data.webhookPath}` : 'No path set';
  if (data.triggerType.startsWith('document.')) {
    return data.documentTypeId ? `Doc type: ${data.documentTypeId}` : 'Any document';
  }
  return 'Fires on user click';
}

export default function TriggerNode(props: NodeProps<TriggerFlowNode>) {
  const { data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  return (
    <BaseNode
      icon="▶"
      subtitle={subtitleFor(data)}
      state={state}
      body={<span style={{ fontStyle: 'italic' }}>{bodyFor(data)}</span>}
      selected={selected}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ background: colors.borderEmphasis, width: 10, height: 10 }}
      />
    </BaseNode>
  );
}
