// frontend/src/components/observability/components/NodeGrid.tsx
//
// Flex-wrap grid of NodeGridTile. Renders per-node summaries in a 16px-gap
// grid. Empty state: "No nodes connected".

import NodeGridTile, { type NodeSummary } from './NodeGridTile';
import { colors } from '../../../constants/styles';

export interface NodeGridProps {
  nodes: NodeSummary[];
  onSelect?: (id: string) => void;
  selectedId?: string;
}

function NodeGrid({ nodes, onSelect, selectedId }: NodeGridProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div
        data-testid="node-grid-empty"
        style={{
          padding: 24,
          textAlign: 'center',
          color: colors.textTertiary,
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      >
        No nodes connected
      </div>
    );
  }

  return (
    <div
      data-testid="node-grid"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        fontFamily: 'inherit',
      }}
    >
      {nodes.map((node) => (
        <NodeGridTile
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          onClick={onSelect ? () => onSelect(node.id) : undefined}
        />
      ))}
    </div>
  );
}

export default NodeGrid;
