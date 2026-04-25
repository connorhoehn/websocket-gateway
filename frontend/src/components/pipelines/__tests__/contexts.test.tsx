// frontend/src/components/pipelines/__tests__/contexts.test.tsx
//
// Unit coverage for the three pipeline React contexts:
//   - EventStreamContext    (pub/sub dispatcher, wildcard channel, no-op subs)
//   - PipelineEditorContext (definition CRUD, undo/redo, save/publish/revert)
//   - PipelineRunsContext   (folds events into the runs map)
//
// Framework: Vitest + @testing-library/react.
//
// Storage: PipelineEditorContext and PipelineRunsContext both go through the
// real pipelineStorage/runHistory modules, which write to `localStorage`.
// jsdom provides a real localStorage implementation, so we clear it in
// beforeEach and seed fixtures through `savePipeline` before mounting.

import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStreamContext,
} from '../context/EventStreamContext';
import {
  PipelineEditorProvider,
  usePipelineEditor,
} from '../context/PipelineEditorContext';
import {
  PipelineRunsProvider,
  usePipelineRuns,
} from '../context/PipelineRunsContext';
import {
  savePipeline,
  loadPipeline,
} from '../persistence/pipelineStorage';
import type {
  ApprovalNodeData,
  LLMNodeData,
  PipelineDefinition,
  PipelineNode,
  PipelineRunTrigger,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearPipelineStorage(): void {
  // Wipe every key the pipeline + run-history modules might have written so
  // state never leaks across tests. This is more aggressive than localStorage
  // .clear() but leaves unrelated test keys alone.
  const toDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith('ws_pipelines_v1') ||
      k.startsWith('ws_pipeline_runs_v1:')
    ) {
      toDelete.push(k);
    }
  }
  for (const k of toDelete) localStorage.removeItem(k);
}

function seedDefinition(id = 'p-1'): PipelineDefinition {
  const now = new Date().toISOString();
  const triggerData: TriggerNodeData = {
    type: 'trigger',
    triggerType: 'manual',
  };
  const trigger: PipelineNode = {
    id: 't1',
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: triggerData,
  };
  const def: PipelineDefinition = {
    id,
    name: 'Test Pipeline',
    version: 1,
    status: 'draft',
    nodes: [trigger],
    edges: [],
    createdAt: now,
    updatedAt: now,
    createdBy: 'tester',
  };
  // `savePipeline` bumps version and writes the definition + index entry.
  savePipeline(def);
  return def;
}

function makeRunTrigger(): PipelineRunTrigger {
  return { userId: 'tester', triggerType: 'manual', payload: {} };
}

// Wrapper factories used by `renderHook({ wrapper })`.

const EventStreamWrapper = ({ children }: { children: React.ReactNode }) => (
  <EventStreamProvider>{children}</EventStreamProvider>
);

function makeEditorWrapper(pipelineId: string) {
  return function EditorWrapper({ children }: { children: React.ReactNode }) {
    return (
      <PipelineEditorProvider pipelineId={pipelineId}>
        {children}
      </PipelineEditorProvider>
    );
  };
}

const RunsWrapper = ({ children }: { children: React.ReactNode }) => (
  <EventStreamProvider>
    <PipelineRunsProvider>{children}</PipelineRunsProvider>
  </EventStreamProvider>
);

// ---------------------------------------------------------------------------
// EventStreamContext
// ---------------------------------------------------------------------------

describe('EventStreamContext', () => {
  test('subscribe(type, handler) receives typed events dispatched under that type', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.run.started', handler);
    });

    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      runId: 'r1',
      pipelineId: 'p1',
    });

    // A different event type must not fire the handler.
    act(() => {
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r1',
        durationMs: 1,
        at: 't',
      });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('subscribe("*", handler) receives every event wrapped as { eventType, payload }', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    act(() => {
      result.current.subscribe('*', handler);
    });

    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r1',
        durationMs: 5,
        at: 't',
      });
    });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0]).toMatchObject({
      eventType: 'pipeline.run.started',
      payload: { runId: 'r1' },
    });
    expect(handler.mock.calls[1][0]).toMatchObject({
      eventType: 'pipeline.run.completed',
      payload: { runId: 'r1', durationMs: 5 },
    });
  });

  test('the cleanup returned by subscribe stops further deliveries', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    let off: (() => void) | undefined;
    act(() => {
      off = result.current.subscribe('pipeline.run.started', handler);
    });

    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });
    expect(handler).toHaveBeenCalledTimes(1);

    act(() => {
      off?.();
    });
    act(() => {
      result.current.dispatch('pipeline.run.started', {
        runId: 'r2',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('multiple handlers registered for the same type all fire', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.step.started', a);
      result.current.subscribe('pipeline.step.started', b);
      result.current.subscribe('pipeline.step.started', c);
    });

    act(() => {
      result.current.dispatch('pipeline.step.started', {
        runId: 'r1',
        stepId: 's1',
        nodeType: 'llm',
        at: 't',
      });
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  test('typed handler fires alongside a wildcard handler on the same dispatch', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const typed = vi.fn();
    const wildcard = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.run.completed', typed);
      result.current.subscribe('*', wildcard);
    });
    act(() => {
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r1',
        durationMs: 1,
        at: 't',
      });
    });
    expect(typed).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
    expect(wildcard.mock.calls[0][0]).toMatchObject({
      eventType: 'pipeline.run.completed',
    });
  });

  test('subscribeToRun / subscribeToAll / subscribeToApprovals are no-ops that return cleanup functions', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    let offRun: (() => void) | undefined;
    let offAll: (() => void) | undefined;
    let offApprovals: (() => void) | undefined;
    act(() => {
      offRun = result.current.subscribeToRun('run-abc');
      offAll = result.current.subscribeToAll();
      offApprovals = result.current.subscribeToApprovals();
    });
    expect(typeof offRun).toBe('function');
    expect(typeof offAll).toBe('function');
    expect(typeof offApprovals).toBe('function');
    expect(() => {
      offRun?.();
      offAll?.();
      offApprovals?.();
    }).not.toThrow();
  });

  test('dispatch with no subscribers does not throw', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    expect(() =>
      act(() => {
        result.current.dispatch('pipeline.run.completed', {
          runId: 'nobody-listening',
          durationMs: 0,
          at: 't',
        });
      }),
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Envelope dedupe (Phase 4 prep — ResourceRouter replay after node failover)
  // -------------------------------------------------------------------------

  test('dispatchEnvelope: duplicate envelope with same (runId, stepId, seq) is dropped', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.step.started', handler);
    });

    const envelope = {
      eventType: 'pipeline.step.started' as const,
      payload: {
        runId: 'r-replay',
        stepId: 's-alpha',
        nodeType: 'llm' as const,
        at: 't',
      },
      seq: 7,
      sourceNodeId: 'node-A',
      emittedAt: 1700000000000,
    };

    act(() => {
      result.current.dispatchEnvelope(envelope);
    });
    expect(handler).toHaveBeenCalledTimes(1);

    // Simulate replay after ResourceRouter reassigns the run — same seq, a
    // different (re-stamped) emittedAt and a different source node id. Must
    // be dropped by the dedupe layer.
    act(() => {
      result.current.dispatchEnvelope({
        ...envelope,
        sourceNodeId: 'node-B',
        emittedAt: 1700000005000,
      });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('dispatchEnvelope: different seq for same step fires twice (retry scenario)', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.step.failed', handler);
    });

    // First attempt of the step fails.
    act(() => {
      result.current.dispatchEnvelope({
        eventType: 'pipeline.step.failed',
        payload: {
          runId: 'r-retry',
          stepId: 's-flaky',
          error: 'transient provider error',
          at: 't1',
        },
        seq: 12,
        sourceNodeId: 'node-A',
        emittedAt: 1700000000000,
      });
    });
    // Executor retries and emits a fresh failure with a new seq.
    act(() => {
      result.current.dispatchEnvelope({
        eventType: 'pipeline.step.failed',
        payload: {
          runId: 'r-retry',
          stepId: 's-flaky',
          error: 'transient provider error (retry 2)',
          at: 't2',
        },
        seq: 18,
        sourceNodeId: 'node-A',
        emittedAt: 1700000005000,
      });
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('dispatchEnvelope: same seq but different runId is not deduped', () => {
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.run.started', handler);
    });

    act(() => {
      result.current.dispatchEnvelope({
        eventType: 'pipeline.run.started',
        payload: {
          runId: 'r-A',
          pipelineId: 'p1',
          triggeredBy: makeRunTrigger(),
          at: 't',
        },
        seq: 0,
        sourceNodeId: 'node-A',
        emittedAt: 1,
      });
      result.current.dispatchEnvelope({
        eventType: 'pipeline.run.started',
        payload: {
          runId: 'r-B',
          pipelineId: 'p1',
          triggeredBy: makeRunTrigger(),
          at: 't',
        },
        seq: 0,
        sourceNodeId: 'node-A',
        emittedAt: 2,
      });
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('dispatch(type, payload) shim auto-envelopes and assigns monotonically increasing seq', () => {
    // Two back-to-back dispatches with the same payload shape should both
    // fire — the shim must not produce colliding envelopes.
    const { result } = renderHook(() => useEventStreamContext(), {
      wrapper: EventStreamWrapper,
    });
    const handler = vi.fn();
    act(() => {
      result.current.subscribe('pipeline.run.completed', handler);
    });

    act(() => {
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r-dup-payload',
        durationMs: 10,
        at: 't',
      });
      result.current.dispatch('pipeline.run.completed', {
        runId: 'r-dup-payload',
        durationMs: 10,
        at: 't',
      });
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('useEventStreamContext throws outside an EventStreamProvider', () => {
    expect(() => renderHook(() => useEventStreamContext())).toThrow(
      /EventStreamProvider/,
    );
  });
});

// ---------------------------------------------------------------------------
// PipelineEditorContext
// ---------------------------------------------------------------------------

describe('PipelineEditorContext', () => {
  beforeEach(() => {
    clearPipelineStorage();
    vi.clearAllMocks();
  });

  test('on mount, definition is loaded from localStorage when a pipeline exists', () => {
    seedDefinition('p-load');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-load'),
    });
    expect(result.current.definition).not.toBeNull();
    expect(result.current.definition?.id).toBe('p-load');
    expect(result.current.definition?.nodes.length).toBe(1);
    expect(result.current.dirty).toBe(false);
  });

  test('on mount with no stored pipeline, definition is null', () => {
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('does-not-exist'),
    });
    expect(result.current.definition).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  test("addNode('llm', { x: 100, y: 100 }) appends a node and marks dirty", () => {
    seedDefinition('p-add');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-add'),
    });
    let newId = '';
    act(() => {
      newId = result.current.addNode('llm', { x: 100, y: 100 });
    });
    expect(newId).toBeTruthy();
    expect(result.current.definition?.nodes.length).toBe(2);
    const added = result.current.definition?.nodes.find((n) => n.id === newId);
    expect(added?.type).toBe('llm');
    expect(added?.position).toEqual({ x: 100, y: 100 });
    // Default LLM data has the right discriminator and sensible defaults.
    expect((added?.data as LLMNodeData).type).toBe('llm');
    expect((added?.data as LLMNodeData).provider).toBe('anthropic');
    expect(result.current.dirty).toBe(true);
    expect(result.current.canUndo).toBe(true);
  });

  test('updateNode(id, { position }) patches the node', () => {
    seedDefinition('p-upd');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-upd'),
    });
    const firstId = result.current.definition!.nodes[0].id;
    act(() => {
      result.current.updateNode(firstId, { position: { x: 500, y: 500 } });
    });
    const node = result.current.definition!.nodes.find((n) => n.id === firstId);
    expect(node?.position).toEqual({ x: 500, y: 500 });
    // Other fields preserved.
    expect(node?.type).toBe('trigger');
    expect(result.current.dirty).toBe(true);
  });

  test("updateNodeData(id, { systemPrompt: '...' }) shallowly merges node.data", () => {
    seedDefinition('p-upd-data');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-upd-data'),
    });
    let llmId = '';
    act(() => {
      llmId = result.current.addNode('llm', { x: 0, y: 0 });
    });
    act(() => {
      result.current.updateNodeData(llmId, {
        systemPrompt: 'hello world',
      } as Partial<LLMNodeData>);
    });
    const node = result.current.definition!.nodes.find((n) => n.id === llmId)!;
    const data = node.data as LLMNodeData;
    expect(data.type).toBe('llm'); // discriminator preserved
    expect(data.systemPrompt).toBe('hello world');
    // Other defaults are preserved by the shallow merge.
    expect(data.model).toBe('claude-sonnet-4-6');
    expect(data.streaming).toBe(true);
  });

  test('removeNode drops the node and every edge connected to it', () => {
    seedDefinition('p-rm');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-rm'),
    });
    const triggerId = result.current.definition!.nodes[0].id;
    let llmId = '';
    act(() => {
      llmId = result.current.addNode('llm', { x: 200, y: 0 });
    });
    act(() => {
      result.current.addEdge({
        source: triggerId,
        sourceHandle: 'out',
        target: llmId,
        targetHandle: 'in',
      });
    });
    expect(result.current.definition?.edges.length).toBe(1);
    act(() => {
      result.current.removeNode(llmId);
    });
    expect(
      result.current.definition?.nodes.find((n) => n.id === llmId),
    ).toBeUndefined();
    expect(result.current.definition?.edges.length).toBe(0);
  });

  test('addEdge returns an id; removeEdge drops the edge by id', () => {
    seedDefinition('p-edge');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-edge'),
    });
    const triggerId = result.current.definition!.nodes[0].id;
    let llmId = '';
    act(() => {
      llmId = result.current.addNode('llm', { x: 10, y: 10 });
    });
    let edgeId = '';
    act(() => {
      edgeId = result.current.addEdge({
        source: triggerId,
        sourceHandle: 'out',
        target: llmId,
        targetHandle: 'in',
      });
    });
    expect(edgeId).toBeTruthy();
    expect(result.current.definition?.edges.length).toBe(1);
    expect(result.current.definition?.edges[0].id).toBe(edgeId);

    act(() => {
      result.current.removeEdge(edgeId);
    });
    expect(result.current.definition?.edges.length).toBe(0);
  });

  test('undo reverts the last node/edge change; redo re-applies it', () => {
    seedDefinition('p-hist');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-hist'),
    });
    const startCount = result.current.definition!.nodes.length;

    act(() => {
      result.current.addNode('llm', { x: 10, y: 10 });
    });
    expect(result.current.definition?.nodes.length).toBe(startCount + 1);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.definition?.nodes.length).toBe(startCount);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.definition?.nodes.length).toBe(startCount + 1);
  });

  test('undo past the oldest snapshot is a safe no-op', () => {
    seedDefinition('p-hist-bottom');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-hist-bottom'),
    });
    expect(result.current.canUndo).toBe(false);
    expect(() =>
      act(() => {
        result.current.undo();
        result.current.undo();
        result.current.undo();
      }),
    ).not.toThrow();
    expect(result.current.canUndo).toBe(false);
  });

  test('save() commits the current definition and resets dirty', () => {
    seedDefinition('p-save');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-save'),
    });
    act(() => {
      result.current.addNode('llm', { x: 0, y: 0 });
    });
    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.save();
    });
    expect(result.current.dirty).toBe(false);

    // Stored definition reflects the commit (has 2 nodes now).
    const stored = loadPipeline('p-save');
    expect(stored?.nodes.length).toBe(2);
  });

  test("rename / setIcon / setTags mark dirty but don't push onto the undo history stack", () => {
    seedDefinition('p-meta');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-meta'),
    });
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.rename('Renamed');
      result.current.setIcon('test-icon');
      result.current.setTags(['a', 'b']);
    });

    expect(result.current.definition?.name).toBe('Renamed');
    expect(result.current.definition?.icon).toBe('test-icon');
    expect(result.current.definition?.tags).toEqual(['a', 'b']);
    expect(result.current.dirty).toBe(true);
    // Metadata-only edits must not be tracked by undo.
    expect(result.current.canUndo).toBe(false);
  });

  test('revert() reloads the definition from localStorage and clears dirty', () => {
    seedDefinition('p-revert');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-revert'),
    });
    act(() => {
      result.current.addNode('llm', { x: 0, y: 0 });
      result.current.addNode('transform', { x: 50, y: 50 });
    });
    expect(result.current.definition?.nodes.length).toBe(3);

    act(() => {
      result.current.revert();
    });
    // Storage still holds the original 1-node seed.
    expect(result.current.definition?.nodes.length).toBe(1);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  test('removeNode also clears the node from selection if it was selected', () => {
    seedDefinition('p-sel');
    const { result } = renderHook(() => usePipelineEditor(), {
      wrapper: makeEditorWrapper('p-sel'),
    });
    let llmId = '';
    act(() => {
      llmId = result.current.addNode('llm', { x: 0, y: 0 });
    });
    act(() => {
      result.current.setSelectedNodeId(llmId);
    });
    expect(result.current.selectedNodeId).toBe(llmId);
    act(() => {
      result.current.removeNode(llmId);
    });
    expect(result.current.selectedNodeId).toBeNull();
  });

  test('usePipelineEditor throws when used outside a PipelineEditorProvider', () => {
    expect(() => renderHook(() => usePipelineEditor())).toThrow(
      /PipelineEditorProvider/,
    );
  });
});

// ---------------------------------------------------------------------------
// PipelineRunsContext
// ---------------------------------------------------------------------------

describe('PipelineRunsContext', () => {
  beforeEach(() => {
    clearPipelineStorage();
    vi.clearAllMocks();
  });

  // Composed hook: pulls both the runs state and the event stream dispatcher
  // from inside a single provider tree so tests can simulate events.
  function useRunsAndStream() {
    return {
      runs: usePipelineRuns(),
      stream: useEventStreamContext(),
    };
  }

  test('dispatching pipeline.run.started adds a running run to the runs map', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: '2026-01-01T00:00:00.000Z',
      });
    });
    const run = result.current.runs.runs['r1'];
    expect(run).toBeDefined();
    expect(run.status).toBe('running');
    expect(run.pipelineId).toBe('p1');
    expect(run.steps).toEqual({});
    expect(result.current.runs.activeRunIds).toContain('r1');
  });

  test('pipeline.step.started writes a step record into run.steps[stepId]', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });
    act(() => {
      result.current.stream.dispatch('pipeline.step.started', {
        runId: 'r1',
        stepId: 's1',
        nodeType: 'llm',
        at: 'then',
      });
    });
    const step = result.current.runs.runs['r1'].steps['s1'];
    expect(step).toBeDefined();
    expect(step.nodeId).toBe('s1');
    expect(step.status).toBe('running');
    expect(step.startedAt).toBe('then');
    expect(result.current.runs.runs['r1'].currentStepIds).toContain('s1');
  });

  test('pipeline.llm.prompt seeds run.steps[stepId].llm with the prompt', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: 'r1',
        stepId: 'llm1',
        nodeType: 'llm',
        at: 't',
      });
    });
    act(() => {
      result.current.stream.dispatch('pipeline.llm.prompt', {
        runId: 'r1',
        stepId: 'llm1',
        model: 'claude-sonnet-4-6',
        prompt: 'Say hello',
        at: 't',
      });
    });
    const step = result.current.runs.runs['r1'].steps['llm1'];
    expect(step.llm).toBeDefined();
    expect(step.llm?.prompt).toBe('Say hello');
    expect(step.llm?.response).toBe('');
    expect(step.llm?.tokensOut).toBe(0);
  });

  test('pipeline.llm.token events accumulate response text and tokensOut', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: 'r1',
        stepId: 'llm1',
        nodeType: 'llm',
        at: 't',
      });
      result.current.stream.dispatch('pipeline.llm.prompt', {
        runId: 'r1',
        stepId: 'llm1',
        model: 'claude-sonnet-4-6',
        prompt: 'prefix',
        at: 't',
      });
    });
    act(() => {
      for (const token of ['Hel', 'lo,', ' wor', 'ld']) {
        result.current.stream.dispatch('pipeline.llm.token', {
          runId: 'r1',
          stepId: 'llm1',
          token,
          at: 't',
        });
      }
    });
    const step = result.current.runs.runs['r1'].steps['llm1'];
    expect(step.llm?.prompt).toBe('prefix'); // prompt preserved
    expect(step.llm?.response).toBe('Hello, world');
    expect(step.llm?.tokensOut).toBe(4);
  });

  test('pipeline.llm.response finalizes prompt/response/token counts on the step', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
      result.current.stream.dispatch('pipeline.step.started', {
        runId: 'r1',
        stepId: 'llm1',
        nodeType: 'llm',
        at: 't',
      });
    });
    act(() => {
      result.current.stream.dispatch('pipeline.llm.response', {
        runId: 'r1',
        stepId: 'llm1',
        response: 'FINAL ANSWER',
        tokensIn: 17,
        tokensOut: 42,
        at: 't',
      });
    });
    const step = result.current.runs.runs['r1'].steps['llm1'];
    expect(step.llm?.response).toBe('FINAL ANSWER');
    expect(step.llm?.tokensIn).toBe(17);
    expect(step.llm?.tokensOut).toBe(42);
  });

  test('pipeline.run.completed flips run.status and captures durationMs', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });
    expect(result.current.runs.runs['r1'].status).toBe('running');
    act(() => {
      result.current.stream.dispatch('pipeline.run.completed', {
        runId: 'r1',
        durationMs: 42,
        at: 'then',
      });
    });
    const run = result.current.runs.runs['r1'];
    expect(run.status).toBe('completed');
    expect(run.durationMs).toBe(42);
    expect(run.completedAt).toBe('then');
    expect(result.current.runs.activeRunIds).not.toContain('r1');
  });

  test('pipeline.approval.requested routes the run into awaiting_approval', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'r1',
        pipelineId: 'p1',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });
    const approvers: ApprovalNodeData['approvers'] = [
      { type: 'user', value: 'u-1' },
    ];
    act(() => {
      result.current.stream.dispatch('pipeline.approval.requested', {
        runId: 'r1',
        stepId: 'ap1',
        approvers,
        at: 't',
      });
    });
    expect(result.current.runs.runs['r1'].status).toBe('awaiting_approval');
    expect(result.current.runs.runs['r1'].steps['ap1'].status).toBe('awaiting');
    expect(result.current.runs.activeRunIds).toContain('r1');
  });

  test('cross-pipeline aggregation: events with different pipelineIds all land in the runs map', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'rA',
        pipelineId: 'pipeline-alpha',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'rB',
        pipelineId: 'pipeline-beta',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
      result.current.stream.dispatch('pipeline.run.started', {
        runId: 'rC',
        pipelineId: 'pipeline-gamma',
        triggeredBy: makeRunTrigger(),
        at: 't',
      });
    });

    expect(Object.keys(result.current.runs.runs).sort()).toEqual([
      'rA',
      'rB',
      'rC',
    ]);
    expect(result.current.runs.runs['rA'].pipelineId).toBe('pipeline-alpha');
    expect(result.current.runs.runs['rB'].pipelineId).toBe('pipeline-beta');
    expect(result.current.runs.runs['rC'].pipelineId).toBe('pipeline-gamma');
    // All three are active.
    expect(result.current.runs.activeRunIds.sort()).toEqual([
      'rA',
      'rB',
      'rC',
    ]);
  });

  test('events referencing an unknown runId are ignored (no run magically created)', () => {
    const { result } = renderHook(useRunsAndStream, { wrapper: RunsWrapper });
    act(() => {
      result.current.stream.dispatch('pipeline.step.started', {
        runId: 'ghost',
        stepId: 's1',
        nodeType: 'llm',
        at: 't',
      });
      result.current.stream.dispatch('pipeline.run.completed', {
        runId: 'ghost',
        durationMs: 0,
        at: 't',
      });
    });
    expect(result.current.runs.runs['ghost']).toBeUndefined();
  });

  test('usePipelineRuns throws when used outside a PipelineRunsProvider', () => {
    expect(() => renderHook(() => usePipelineRuns())).toThrow(
      /PipelineRunsProvider/,
    );
  });
});
