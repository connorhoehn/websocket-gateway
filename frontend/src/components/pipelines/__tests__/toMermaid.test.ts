// frontend/src/components/pipelines/__tests__/toMermaid.test.ts
//
// Unit tests for the Mermaid flowchart exporter. Covers shape selection,
// default-handle suppression, and a full trigger → llm → condition fan-out.

import { describe, test, expect } from 'vitest';
import { toMermaid } from '../export/toMermaid';
import type {
  ActionNodeData,
  ApprovalNodeData,
  ConditionNodeData,
  ForkNodeData,
  LLMNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TriggerNodeData,
} from '../../../types/pipeline';

function makeDef(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): PipelineDefinition {
  const now = new Date().toISOString();
  return {
    id: 'p',
    name: 'test',
    version: 1,
    status: 'draft',
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy: 'u',
  };
}

describe('toMermaid', () => {
  test('simple trigger → llm → action emits the expected lines', () => {
    const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
    const llmData: LLMNodeData = {
      type: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: 's',
      userPromptTemplate: 'u',
      streaming: true,
    };
    const actionData: ActionNodeData = {
      type: 'action',
      actionType: 'notify',
      config: {},
    };
    const nodes: PipelineNode[] = [
      { id: 'T', type: 'trigger', position: { x: 0, y: 0 }, data: triggerData },
      { id: 'L', type: 'llm', position: { x: 0, y: 0 }, data: llmData },
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, data: actionData },
    ];
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'T', sourceHandle: 'out', target: 'L', targetHandle: 'in' },
      { id: 'e2', source: 'L', sourceHandle: 'out', target: 'A', targetHandle: 'in' },
    ];

    const out = toMermaid(makeDef(nodes, edges));
    expect(out.split('\n')[0]).toBe('flowchart TD');
    // LLM uses round-rect `(...)` and includes the model name.
    expect(out).toContain('llm1("🧠 LLM<br/>claude-sonnet-4-6")');
    // Trigger uses default rect.
    expect(out).toContain('t1["▶ Trigger<br/>manual"]');
    // Action uses default rect.
    expect(out).toContain('a1["⚡ Action<br/>notify"]');
    // Default `out` edges have no label.
    expect(out).toContain('t1 --> llm1');
    expect(out).toContain('llm1 --> a1');
    // Default edges should NOT get a label
    expect(out).not.toMatch(/t1 --"out"--> llm1/);
  });

  test('condition uses diamond shape and true/false edge labels', () => {
    const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
    const conditionData: ConditionNodeData = {
      type: 'condition',
      expression: 'x > 0',
      label: 'Long summary?',
    };
    const actionData: ActionNodeData = {
      type: 'action',
      actionType: 'notify',
      config: {},
    };
    const nodes: PipelineNode[] = [
      { id: 'T', type: 'trigger', position: { x: 0, y: 0 }, data: triggerData },
      { id: 'C', type: 'condition', position: { x: 0, y: 0 }, data: conditionData },
      { id: 'A1', type: 'action', position: { x: 0, y: 0 }, data: actionData },
      { id: 'A2', type: 'action', position: { x: 0, y: 0 }, data: actionData },
    ];
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'T', sourceHandle: 'out', target: 'C', targetHandle: 'in' },
      { id: 'e2', source: 'C', sourceHandle: 'true', target: 'A1', targetHandle: 'in' },
      { id: 'e3', source: 'C', sourceHandle: 'false', target: 'A2', targetHandle: 'in' },
    ];

    const out = toMermaid(makeDef(nodes, edges));
    // Diamond shape for condition, includes label hint.
    expect(out).toContain('c1{"❓ Condition<br/>Long summary?"}');
    // Edge labels on non-default handles.
    expect(out).toContain('c1 --"true"--> a1');
    expect(out).toContain('c1 --"false"--> a2');
  });

  test('fork/approval use special shapes with hints', () => {
    const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
    const forkData: ForkNodeData = { type: 'fork', branchCount: 3 };
    const approvalData: ApprovalNodeData = {
      type: 'approval',
      approvers: [
        { type: 'user', value: 'u1' },
        { type: 'role', value: 'admin' },
      ],
      requiredCount: 1,
    };
    const nodes: PipelineNode[] = [
      { id: 'T', type: 'trigger', position: { x: 0, y: 0 }, data: triggerData },
      { id: 'F', type: 'fork', position: { x: 0, y: 0 }, data: forkData },
      { id: 'AP', type: 'approval', position: { x: 0, y: 0 }, data: approvalData },
    ];
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'T', sourceHandle: 'out', target: 'F', targetHandle: 'in' },
      { id: 'e2', source: 'F', sourceHandle: 'branch-0', target: 'AP', targetHandle: 'in' },
    ];

    const out = toMermaid(makeDef(nodes, edges));
    // Hexagon for fork with branch count hint.
    expect(out).toContain('f1{{"🔀 Fork<br/>3 branches"}}');
    // Trapezoid for approval with approver count hint.
    expect(out).toContain('ap1[/"✋ Approval<br/>2 approvers"\\]');
    // Branch-N edge label preserved.
    expect(out).toContain('f1 --"branch-0"--> ap1');
  });

  test('ignores edges referencing missing nodes', () => {
    const triggerData: TriggerNodeData = { type: 'trigger', triggerType: 'manual' };
    const nodes: PipelineNode[] = [
      { id: 'T', type: 'trigger', position: { x: 0, y: 0 }, data: triggerData },
    ];
    const edges: PipelineEdge[] = [
      { id: 'dangling', source: 'T', sourceHandle: 'out', target: 'MISSING', targetHandle: 'in' },
    ];
    const out = toMermaid(makeDef(nodes, edges));
    expect(out).toContain('t1[');
    expect(out).not.toContain('MISSING');
  });
});
