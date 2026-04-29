// frontend/src/components/pipelines/dev/useDevEditorBridge.ts
//
// Dev-only bridge that exposes a small imperative API on
// `window.__pipelineEditor` so Playwright (and console-level debugging) can
// drive the canvas without going through the fragile HTML5 drag-and-drop
// or React Flow handle-connection paths. Stripped from production builds via
// the `import.meta.env.DEV` gate.
//
// Mirrors the pattern used for `window.__pipelineDemo` in App.tsx:35.

import { useEffect } from 'react';

import type { NodeData, NodeType, PipelineDefinition } from '../../../types/pipeline';

interface DevEditorBridge {
  insertNode: (
    type: NodeType,
    position?: { x: number; y: number },
  ) => string;
  connect: (
    sourceId: string,
    targetId: string,
    opts?: { sourceHandle?: string; targetHandle?: string },
  ) => string;
  updateNodeData: (id: string, patch: Partial<NodeData>) => void;
  getDefinition: () => PipelineDefinition | null;
  findNodeIdByType: (type: NodeType) => string | undefined;
}

declare global {
  interface Window {
    __pipelineEditor?: DevEditorBridge;
  }
}

interface BridgeDeps {
  addNode: (type: NodeType, position: { x: number; y: number }) => string;
  addEdge: (edge: {
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
  }) => string;
  updateNodeData: (id: string, patch: Partial<NodeData>) => void;
  getDefinition: () => PipelineDefinition | null;
}

export function useDevEditorBridge({
  addNode,
  addEdge,
  updateNodeData,
  getDefinition,
}: BridgeDeps): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const bridge: DevEditorBridge = {
      insertNode(type, position) {
        const pos = position ?? { x: 240, y: 80 + Math.random() * 40 };
        return addNode(type, pos);
      },
      connect(sourceId, targetId, opts) {
        return addEdge({
          source: sourceId,
          sourceHandle: opts?.sourceHandle ?? 'out',
          target: targetId,
          targetHandle: opts?.targetHandle ?? 'in',
        });
      },
      updateNodeData,
      getDefinition,
      findNodeIdByType(type) {
        return getDefinition()?.nodes.find((n) => n.type === type)?.id;
      },
    };

    window.__pipelineEditor = bridge;
    return () => {
      if (window.__pipelineEditor === bridge) {
        delete window.__pipelineEditor;
      }
    };
  }, [addNode, addEdge, updateNodeData, getDefinition]);
}
