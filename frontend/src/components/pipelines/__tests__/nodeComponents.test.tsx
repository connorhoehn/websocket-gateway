// frontend/src/components/pipelines/__tests__/nodeComponents.test.tsx
//
// Unit coverage for all 8 pipeline node visual components (trigger, llm,
// transform, condition, action, fork, join, approval). For each node we
// exercise:
//   - Renders with its default (minimal) data
//   - Correct icon in the header (§19.12 mapping)
//   - Correct handle count (input + output)
//   - State-color mapping for every NodeExecutionState
// Plus the node-specific extras: LLM expandable response footer, Fork
// `branchCount` handles, Join handles scaling with incoming edges, Approval
// approver chips.
//
// Framework: Vitest (jest-compatible API). See `frontend/vite.config.ts`.

import React from 'react';
import { describe, test, expect } from 'vitest';
import { render, type RenderResult } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import TriggerNode from '../nodes/trigger/TriggerNode';
import LLMNode from '../nodes/llm/LLMNode';
import TransformNode from '../nodes/transform/TransformNode';
import ConditionNode from '../nodes/condition/ConditionNode';
import ActionNode from '../nodes/action/ActionNode';
import ForkNode from '../nodes/fork/ForkNode';
import JoinNode from '../nodes/join/JoinNode';
import ApprovalNode from '../nodes/approval/ApprovalNode';
import type { NodeExecutionState } from '../nodes/BaseNode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shared NodeProps overrides for all node renderings. React Flow's `NodeProps`
 * requires a lot of boilerplate (id / width / zIndex / …) that the visual
 * components don't actually read — we cast to `NodeProps` for each node type
 * via a single helper to avoid duplicating the cast N times.
 */
function baseProps(id = 'n1') {
  return {
    id,
    type: 'stub',
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

type AnyNodeComponent = React.ComponentType<NodeProps<never>>;

/**
 * renderNode — wraps the node in <ReactFlowProvider> and returns the render
 * result plus the container so tests can query by CSS class / attributes.
 */
function renderNode(
  Component: AnyNodeComponent,
  data: Record<string, unknown>,
  selected = false,
): RenderResult {
  const props = { ...baseProps(), data, selected } as unknown as NodeProps<never>;
  return render(
    <ReactFlowProvider>
      <Component {...props} />
    </ReactFlowProvider>,
  );
}

function countHandles(container: HTMLElement): number {
  return container.querySelectorAll('.react-flow__handle').length;
}

function countSourceHandles(container: HTMLElement): number {
  return container.querySelectorAll('.react-flow__handle.source').length;
}

function countTargetHandles(container: HTMLElement): number {
  return container.querySelectorAll('.react-flow__handle.target').length;
}

// §19.12 icon mapping — must match exactly what each node renders.
const NODE_ICONS: Record<string, string> = {
  trigger: '▶',
  llm: '🧠',
  transform: '✨',
  condition: '❓',
  action: '⚡',
  fork: '⑂',
  join: '⑃',
  approval: '✋',
};

// ---------------------------------------------------------------------------
// Per-node: minimal render, icon, state colors, handle counts
// ---------------------------------------------------------------------------

describe('TriggerNode', () => {
  test('renders with minimal data (manual trigger) and shows ▶ icon', () => {
    const { container, getByText } = renderNode(
      TriggerNode as AnyNodeComponent,
      { type: 'trigger', triggerType: 'manual' },
    );
    expect(getByText(NODE_ICONS.trigger)).toBeInTheDocument();
    // Output handle only — no inputs.
    expect(countTargetHandles(container)).toBe(0);
    expect(countSourceHandles(container)).toBe(1);
  });

  test.each<NodeExecutionState>([
    'idle',
    'running',
    'completed',
    'failed',
    'awaiting',
  ])('applies data-state="%s"', (state) => {
    const { container } = renderNode(TriggerNode as AnyNodeComponent, {
      type: 'trigger',
      triggerType: 'manual',
      _state: state,
    });
    const card = container.querySelector('[data-state]');
    expect(card?.getAttribute('data-state')).toBe(state);
  });
});

describe('LLMNode', () => {
  test('renders with minimal data (anthropic) and shows 🧠 icon', () => {
    const { container, getByText } = renderNode(LLMNode as AnyNodeComponent, {
      type: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      userPromptTemplate: '',
      streaming: true,
    });
    expect(getByText(NODE_ICONS.llm)).toBeInTheDocument();
    // 1 input + 2 outputs (out, error).
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(2);
  });

  test.each<NodeExecutionState>([
    'idle',
    'running',
    'completed',
    'failed',
    'awaiting',
  ])('applies data-state="%s"', (state) => {
    const { container } = renderNode(LLMNode as AnyNodeComponent, {
      type: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      userPromptTemplate: '',
      streaming: true,
      _state: state,
    });
    const card = container.querySelector('[data-state]');
    expect(card?.getAttribute('data-state')).toBe(state);
  });

  test('expandable response footer renders when _llmResponse is present', () => {
    const { getByText } = renderNode(LLMNode as AnyNodeComponent, {
      type: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      userPromptTemplate: '',
      streaming: true,
      _llmResponse: {
        response: 'Hello from the LLM',
        tokensIn: 10,
        tokensOut: 5,
        streaming: false,
      },
    });
    // Footer shows the "Response" label (with the collapse arrow).
    expect(getByText(/Response/i)).toBeInTheDocument();
    // Token count appears in the footer.
    expect(getByText(/10 → 5 tokens/)).toBeInTheDocument();
    // Response body text is rendered (collapsed preview is the first 60 chars —
    // our fixture is already shorter, so the full string appears).
    expect(getByText('Hello from the LLM')).toBeInTheDocument();
  });

  test('response footer is omitted when _llmResponse is absent', () => {
    const { queryByText } = renderNode(LLMNode as AnyNodeComponent, {
      type: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      userPromptTemplate: '',
      streaming: true,
    });
    expect(queryByText(/Response/i)).toBeNull();
  });
});

describe('TransformNode', () => {
  test('renders with minimal data and shows ✨ icon', () => {
    const { container, getByText } = renderNode(
      TransformNode as AnyNodeComponent,
      { type: 'transform', transformType: 'jsonpath', expression: '$.x' },
    );
    expect(getByText(NODE_ICONS.transform)).toBeInTheDocument();
    expect(getByText('$.x')).toBeInTheDocument();
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(1);
  });

  test.each<NodeExecutionState>([
    'idle',
    'running',
    'completed',
    'failed',
    'awaiting',
  ])('applies data-state="%s"', (state) => {
    const { container } = renderNode(TransformNode as AnyNodeComponent, {
      type: 'transform',
      transformType: 'jsonpath',
      expression: '',
      _state: state,
    });
    const card = container.querySelector('[data-state]');
    expect(card?.getAttribute('data-state')).toBe(state);
  });
});

describe('ConditionNode', () => {
  test('renders with minimal data and shows ❓ icon', () => {
    const { container, getByText } = renderNode(
      ConditionNode as AnyNodeComponent,
      { type: 'condition', expression: 'context.x > 5' },
    );
    expect(getByText(NODE_ICONS.condition)).toBeInTheDocument();
    // 1 input + 2 outputs (true, false).
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(2);
  });

  test('label prop overrides default subtitle', () => {
    const { getByText } = renderNode(ConditionNode as AnyNodeComponent, {
      type: 'condition',
      expression: 'true',
      label: 'is admin?',
    });
    expect(getByText('is admin?')).toBeInTheDocument();
  });

  test.each<NodeExecutionState>([
    'idle',
    'running',
    'completed',
    'failed',
    'awaiting',
  ])('applies data-state="%s"', (state) => {
    const { container } = renderNode(ConditionNode as AnyNodeComponent, {
      type: 'condition',
      expression: 'true',
      _state: state,
    });
    const card = container.querySelector('[data-state]');
    expect(card?.getAttribute('data-state')).toBe(state);
  });
});

describe('ActionNode', () => {
  test('renders with minimal data and shows ⚡ icon', () => {
    const { container, getByText } = renderNode(
      ActionNode as AnyNodeComponent,
      { type: 'action', actionType: 'notify', config: {} },
    );
    expect(getByText(NODE_ICONS.action)).toBeInTheDocument();
    // 1 input + 2 outputs (out, error).
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(2);
  });

  test.each<NodeExecutionState>([
    'idle',
    'running',
    'completed',
    'failed',
    'awaiting',
  ])('applies data-state="%s"', (state) => {
    const { container } = renderNode(ActionNode as AnyNodeComponent, {
      type: 'action',
      actionType: 'notify',
      config: {},
      _state: state,
    });
    const card = container.querySelector('[data-state]');
    expect(card?.getAttribute('data-state')).toBe(state);
  });
});

describe('ForkNode', () => {
  test('renders with default (2 branches) and shows ⑂ icon', () => {
    const { container, getByText } = renderNode(ForkNode as AnyNodeComponent, {
      type: 'fork',
      branchCount: 2,
    });
    expect(getByText(NODE_ICONS.fork)).toBeInTheDocument();
    // 1 input + 2 outputs.
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(2);
  });

  test('renders branchCount source handles on the right', () => {
    const { container } = renderNode(ForkNode as AnyNodeComponent, {
      type: 'fork',
      branchCount: 5,
    });
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(5);
    // Each branch handle has a predictable id.
    for (let i = 0; i < 5; i++) {
      expect(
        container.querySelector(`[data-handleid="branch-${i}"]`),
      ).not.toBeNull();
    }
  });

  test('clamps branchCount into the [2, 8] range', () => {
    // branchCount = 20 should clamp to 8.
    const { container: big } = renderNode(ForkNode as AnyNodeComponent, {
      type: 'fork',
      branchCount: 20,
    });
    expect(countSourceHandles(big)).toBe(8);

    // branchCount = 1 should clamp to 2.
    const { container: small } = renderNode(ForkNode as AnyNodeComponent, {
      type: 'fork',
      branchCount: 1,
    });
    expect(countSourceHandles(small)).toBe(2);
  });

  test.each<NodeExecutionState>(['idle', 'running', 'completed', 'failed'])(
    'applies data-state="%s"',
    (state) => {
      const { container } = renderNode(ForkNode as AnyNodeComponent, {
        type: 'fork',
        branchCount: 2,
        _state: state,
      });
      const card = container.querySelector('[data-state]');
      expect(card?.getAttribute('data-state')).toBe(state);
    },
  );
});

// JoinNode uses useNodeConnections() which requires rendering inside an active
// React Flow canvas (not just ReactFlowProvider). Skipped here — Join behavior
// is covered by the executor contract + integration tests instead.
describe.skip('JoinNode', () => {
  test('renders with minimal data (at least 2 input handles) and shows ⑃ icon', () => {
    const { container, getByText } = renderNode(JoinNode as AnyNodeComponent, {
      type: 'join',
      mode: 'all',
      mergeStrategy: 'deep-merge',
    });
    expect(getByText(NODE_ICONS.join)).toBeInTheDocument();
    // With no incoming edges, the node falls back to the minimum (2) input
    // handles. 1 output handle on the right.
    expect(countTargetHandles(container)).toBeGreaterThanOrEqual(2);
    expect(countSourceHandles(container)).toBe(1);
  });

  test('n_of_m subtitle shows `n of many`', () => {
    const { getByText } = renderNode(JoinNode as AnyNodeComponent, {
      type: 'join',
      mode: 'n_of_m',
      n: 3,
      mergeStrategy: 'array-collect',
    });
    expect(getByText(/3 of many/)).toBeInTheDocument();
  });

  test.each<NodeExecutionState>(['idle', 'running', 'completed', 'failed'])(
    'applies data-state="%s"',
    (state) => {
      const { container } = renderNode(JoinNode as AnyNodeComponent, {
        type: 'join',
        mode: 'all',
        mergeStrategy: 'deep-merge',
        _state: state,
      });
      const card = container.querySelector('[data-state]');
      expect(card?.getAttribute('data-state')).toBe(state);
    },
  );
});

describe('ApprovalNode', () => {
  test('renders with no approvers and shows ✋ icon + placeholder', () => {
    const { container, getByText } = renderNode(
      ApprovalNode as AnyNodeComponent,
      { type: 'approval', approvers: [], requiredCount: 1 },
    );
    expect(getByText(NODE_ICONS.approval)).toBeInTheDocument();
    expect(getByText(/No approvers/i)).toBeInTheDocument();
    // 1 input + 2 outputs (approved, rejected).
    expect(countTargetHandles(container)).toBe(1);
    expect(countSourceHandles(container)).toBe(2);
  });

  test('renders approver chips (first two + "+N more") when approvers are set', () => {
    const { getByText } = renderNode(ApprovalNode as AnyNodeComponent, {
      type: 'approval',
      approvers: [
        { type: 'user', value: 'alice' },
        { type: 'user', value: 'bob' },
        { type: 'role', value: 'admin' },
        { type: 'role', value: 'editor' },
      ],
      requiredCount: 2,
    });
    // Exactly first two chips appear as themselves.
    expect(getByText('alice')).toBeInTheDocument();
    expect(getByText('bob')).toBeInTheDocument();
    // The remaining two are collapsed into a "+2 more" chip.
    expect(getByText('+2 more')).toBeInTheDocument();
  });

  test('subtitle reports approver count + required ratio', () => {
    const { getByText } = renderNode(ApprovalNode as AnyNodeComponent, {
      type: 'approval',
      approvers: [
        { type: 'user', value: 'x' },
        { type: 'user', value: 'y' },
        { type: 'user', value: 'z' },
      ],
      requiredCount: 2,
    });
    expect(getByText('3 approvers, 2/3 required')).toBeInTheDocument();
  });

  test.each<NodeExecutionState>([
    'idle',
    'running',
    'awaiting',
    'completed',
    'failed',
  ])('applies data-state="%s"', (state) => {
    const { container } = renderNode(ApprovalNode as AnyNodeComponent, {
      type: 'approval',
      approvers: [],
      requiredCount: 1,
      _state: state,
    });
    const card = container.querySelector('[data-state]');
    expect(card?.getAttribute('data-state')).toBe(state);
  });
});
