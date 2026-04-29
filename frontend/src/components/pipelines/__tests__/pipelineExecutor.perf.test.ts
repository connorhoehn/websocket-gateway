// frontend/src/components/pipelines/__tests__/pipelineExecutor.perf.test.ts
//
// PERFORMANCE + STRESS TEST SUITE for MockExecutor.
//
// These tests exercise the executor at scale — many concurrent runs, large
// pipeline shapes (long linear chains, wide fork/join fans), heavy event
// volume (LLM token streams), and memory hygiene (timer cleanup, cancel
// responsiveness). They complement the behavioral guarantees pinned down in
// `pipelineExecutor.contract.test.ts`.
//
// Speed multipliers are aggressive (0.005–0.02) so the whole suite runs
// comfortably under 15s. The MockExecutor's `sleep()` clamps at
// `max(50, ms) * speedMultiplier`, so with `speedMultiplier: 0.005` the
// minimum per-sleep is 0.25ms — fast enough for hundreds of concurrent runs.

import { describe, test, expect, vi } from 'vitest';
import { MockExecutor } from '../mock/MockExecutor';
import type { MockExecutorOptions } from '../mock/MockExecutor';
import type {
  ActionNodeData,
  ForkNodeData,
  JoinMode,
  JoinNodeData,
  LLMNodeData,
  NodeData,
  NodeType,
  PipelineDefinition,
  PipelineEdge,
  PipelineEventMap,
  PipelineNode,
  PipelineRun,
  TransformNodeData,
  TriggerNodeData,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Builder helpers — mirrors pipelineExecutor.contract.test.ts shape so the
// two suites use the same mental model (see that file for full context).
// ---------------------------------------------------------------------------

let nodeIdSeq = 0;
let edgeIdSeq = 0;
let pipelineIdSeq = 0;

function nextNodeId(prefix = 'n'): string {
  nodeIdSeq += 1;
  return `${prefix}-${nodeIdSeq}`;
}

function nextEdgeId(): string {
  edgeIdSeq += 1;
  return `e-${edgeIdSeq}`;
}

function nextPipelineId(): string {
  pipelineIdSeq += 1;
  return `perf-pipe-${pipelineIdSeq}`;
}

/** Make a `PipelineEdge`; handles default to 'out' / 'in'. */
function makeEdge(
  source: string,
  target: string,
  sourceHandle = 'out',
  targetHandle = 'in',
): PipelineEdge {
  return { id: nextEdgeId(), source, sourceHandle, target, targetHandle };
}

/** Make a `PipelineNode` with the given data payload. */
function makeNode<D extends NodeData>(id: string, data: D, x = 0, y = 0): PipelineNode {
  return { id, type: data.type, position: { x, y }, data };
}

/** Wrap a nodes/edges pair into a full `PipelineDefinition`. */
function buildPipeline(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineDefinition {
  const now = new Date().toISOString();
  return {
    id: nextPipelineId(),
    name: 'Perf test pipeline',
    version: 1,
    status: 'published',
    publishedVersion: 1,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    createdBy: 'perf-test',
  };
}

// Typed factories for each node type used by the perf suite.

function triggerData(): TriggerNodeData {
  return { type: 'trigger', triggerType: 'manual' };
}

function llmData(): LLMNodeData {
  return {
    type: 'llm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Please produce a long detailed response.',
    userPromptTemplate: 'Summarize {{context.body}}',
    streaming: true,
  };
}

function transformData(): TransformNodeData {
  return { type: 'transform', transformType: 'template', expression: '{{ context.body }}' };
}

function actionData(): ActionNodeData {
  return { type: 'action', actionType: 'notify', config: {} };
}

function forkData(branchCount: number): ForkNodeData {
  return { type: 'fork', branchCount };
}

function joinData(mode: JoinMode, n?: number): JoinNodeData {
  const data: JoinNodeData = { type: 'join', mode, mergeStrategy: 'deep-merge' };
  if (mode === 'n_of_m' && n !== undefined) data.n = n;
  return data;
}

/**
 * Build a simple chain of the given node types. The first must be a trigger.
 * Example: `buildLinearPipeline(['trigger', 'transform', 'action'])`.
 */
function buildLinearPipeline(types: NodeType[]): PipelineDefinition {
  if (types[0] !== 'trigger') {
    throw new Error('buildLinearPipeline: first type must be "trigger"');
  }
  const nodes: PipelineNode[] = types.map((t) => {
    const id = nextNodeId(t);
    switch (t) {
      case 'trigger':
        return makeNode(id, triggerData());
      case 'llm':
        return makeNode(id, llmData());
      case 'transform':
        return makeNode(id, transformData());
      case 'action':
        return makeNode(id, actionData());
      default:
        throw new Error(`buildLinearPipeline: unsupported type "${t}" (use fork/join helpers)`);
    }
  });
  const edges: PipelineEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push(makeEdge(nodes[i]!.id, nodes[i + 1]!.id));
  }
  return buildPipeline(nodes, edges);
}

/**
 * Build a fork/join diamond:
 *   trigger -> fork(branchCount) -> branchCount parallel actions -> join(mode) -> action
 * For mode='n_of_m', n defaults to ceil(branchCount / 2).
 */
function buildForkJoinPipeline(branchCount: number, mode: JoinMode): PipelineDefinition {
  const t = makeNode(nextNodeId('trigger'), triggerData());
  const f = makeNode(nextNodeId('fork'), forkData(branchCount));
  const branches = Array.from({ length: branchCount }, () =>
    makeNode(nextNodeId('branch'), actionData()),
  );
  const n = mode === 'n_of_m' ? Math.max(1, Math.ceil(branchCount / 2)) : undefined;
  const j = makeNode(nextNodeId('join'), joinData(mode, n));
  const tail = makeNode(nextNodeId('tail'), actionData());

  const nodes = [t, f, ...branches, j, tail];
  const edges: PipelineEdge[] = [
    makeEdge(t.id, f.id),
    ...branches.map((b) => makeEdge(f.id, b.id, 'out')),
    ...branches.map((b) => makeEdge(b.id, j.id)),
    makeEdge(j.id, tail.id),
  ];
  return buildPipeline(nodes, edges);
}

// ---------------------------------------------------------------------------
// Execution helper — runs a definition to terminal state and returns the
// run plus a flat (type, payload) event log. Uses 0 failure rates unless the
// caller overrides.
// ---------------------------------------------------------------------------

async function runToCompletion(
  def: PipelineDefinition,
  opts: Partial<MockExecutorOptions> = {},
): Promise<{ run: PipelineRun; events: Array<[keyof PipelineEventMap, unknown]> }> {
  const events: Array<[keyof PipelineEventMap, unknown]> = [];
  const executor = new MockExecutor({
    definition: def,
    triggerPayload: opts.triggerPayload,
    failureRateLLM: opts.failureRateLLM ?? 0,
    failureRateOther: opts.failureRateOther ?? 0,
    speedMultiplier: opts.speedMultiplier ?? 0.02,
    onEvent: (type, payload) => events.push([type, payload]),
  });
  const run = await executor.run();
  return { run, events };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MockExecutor performance + stress', () => {
  // -------------------------------------------------------------------------
  describe('Throughput', () => {
    test('runs a trigger → transform → action pipeline within expected time', async () => {
      // Three-step linear pipeline at aggressive speed (0.02x).
      // Each sleep clamps to max(50, mean) * 0.02 = 1ms floor — so the pipeline
      // should easily fit in a 500ms budget.
      const def = buildLinearPipeline(['trigger', 'transform', 'action']);
      const t0 = Date.now();
      const { run } = await runToCompletion(def, { speedMultiplier: 0.02 });
      const elapsed = Date.now() - t0;
      expect(run.status).toBe('completed');
      expect(elapsed).toBeLessThan(500);
    });

    test('100 concurrent runs complete without crashing', async () => {
      // 100 independent executors running simultaneously. This stresses the
      // microtask queue and timer scheduling; if the executor leaks state
      // between runs or contends on shared resources, we'll see failures.
      const def = buildLinearPipeline(['trigger', 'action']);
      const runs = Array.from({ length: 100 }, () =>
        runToCompletion(def, { speedMultiplier: 0.01 }),
      );
      const results = await Promise.all(runs);
      expect(results.length).toBe(100);
      expect(results.every((r) => r.run.status === 'completed')).toBe(true);
    }, 20000);

    test('50 concurrent runs of a 3-step pipeline all reach completed', async () => {
      // Wider pipeline with 50 concurrent instances — proves that multi-step
      // state does not cross-contaminate between executor instances.
      const def = buildLinearPipeline(['trigger', 'transform', 'action']);
      const runs = Array.from({ length: 50 }, () =>
        runToCompletion(def, { speedMultiplier: 0.01 }),
      );
      const results = await Promise.all(runs);
      const statuses = results.map((r) => r.run.status);
      expect(statuses.filter((s) => s === 'completed').length).toBe(50);
    }, 15000);
  });

  // -------------------------------------------------------------------------
  describe('Large pipeline shapes', () => {
    test('50-node linear chain completes', async () => {
      // trigger → 48 transforms in a chain → action (50 nodes total).
      // This verifies the traversal recursion / promise chain handles depth
      // without blowing the stack or drifting on timing.
      const nodes: PipelineNode[] = [makeNode(nextNodeId('trigger'), triggerData())];
      for (let i = 0; i < 48; i++) {
        nodes.push(makeNode(nextNodeId('xform'), transformData()));
      }
      nodes.push(makeNode(nextNodeId('action'), actionData()));
      const edges: PipelineEdge[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push(makeEdge(nodes[i]!.id, nodes[i + 1]!.id));
      }
      const def = buildPipeline(nodes, edges);

      const { run, events } = await runToCompletion(def, { speedMultiplier: 0.005 });
      expect(run.status).toBe('completed');

      // Every node must have a completed terminal event.
      const completedIds = new Set(
        events
          .filter(([t]) => t === 'pipeline.step.completed')
          .map(([, p]) => (p as { stepId: string }).stepId),
      );
      expect(completedIds.size).toBe(50);
    }, 15000);

    test('Fork 8 branches → Join-all completes', async () => {
      // Wide fork/join shape: 8 parallel branches all feed into a Join(all)
      // which must accumulate every arrival before firing.
      const def = buildForkJoinPipeline(8, 'all');
      const { run, events } = await runToCompletion(def, { speedMultiplier: 0.01 });
      expect(run.status).toBe('completed');

      // Join should have fired exactly once with 8 inputs.
      const joinFired = events.filter(([t]) => t === 'pipeline.join.fired');
      expect(joinFired.length).toBe(1);
      expect((joinFired[0]![1] as { inputs: string[] }).inputs.length).toBe(8);
    }, 10000);

    test('Fork 8 → Join any fires on first completion', async () => {
      // 'any' mode should fire after a single branch completes. We can't
      // assert *which* branch arrives first (non-deterministic under the
      // normal-sampled sleep jitter), but we can assert exactly one fire.
      const def = buildForkJoinPipeline(8, 'any');
      const { run, events } = await runToCompletion(def, { speedMultiplier: 0.01 });
      expect(run.status).toBe('completed');

      const joinFired = events.filter(([t]) => t === 'pipeline.join.fired');
      expect(joinFired.length).toBe(1);
    }, 10000);

    test('Fork 8 → Join n_of_m fires after n completions', async () => {
      // With mode='n_of_m' and branchCount=8, the default n is ceil(8/2) = 4.
      const def = buildForkJoinPipeline(8, 'n_of_m');
      const { run, events } = await runToCompletion(def, { speedMultiplier: 0.01 });
      expect(run.status).toBe('completed');

      // Single fire; every waiting event reports required=4.
      const joinFired = events.filter(([t]) => t === 'pipeline.join.fired');
      expect(joinFired.length).toBe(1);

      const waiting = events.filter(([t]) => t === 'pipeline.join.waiting');
      expect(waiting.length).toBeGreaterThanOrEqual(1);
      for (const [, payload] of waiting) {
        expect((payload as { required: number }).required).toBe(4);
      }
    }, 10000);
  });

  // -------------------------------------------------------------------------
  describe('Event volume', () => {
    test('LLM streaming emits proportional token count', async () => {
      // The LLM step emits one pipeline.llm.token per token in the response
      // (up to its totalMs budget). We don't assert an exact count — jitter
      // and budget truncation make that brittle — but we do assert that the
      // token count correlates with the response word count.
      //
      // Determinism: this test used to flake under heavy parallel CPU because
      // (a) `await this.sleep(perToken)` raced wall-clock against the
      // executor's `totalMs` budget, and (b) `sampleNormal` (Box-Muller via
      // `Math.random()`) sometimes drew a low `totalMs` that truncated the
      // stream below the 50% threshold. We pin both axes:
      //   1. `vi.useFakeTimers()` — sleeps advance virtual time only, so the
      //      test never races a real CPU scheduler.
      //   2. `Math.random()` is stubbed to 0.25 so Box-Muller's `cos(2π·u)`
      //      term is exactly 0 — every `sampleNormal(mean, stdev)` returns
      //      `max(50, mean)`. `totalMs` lands at the fixture's mean (4200ms
      //      for the long-form summary) and `perToken` lands at 20ms (clamped
      //      to a 50ms sleep floor).
      const def = buildLinearPipeline(['trigger', 'llm']);

      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
      try {
        const events: Array<[keyof PipelineEventMap, unknown]> = [];
        const executor = new MockExecutor({
          definition: def,
          failureRateLLM: 0,
          failureRateOther: 0,
          // speedMultiplier=1 so the full token budget is available; the
          // sleep clamp `max(50, ms) * 1` still applies under fake timers.
          speedMultiplier: 1,
          onEvent: (type, payload) => events.push([type, payload]),
        });

        const runPromise = executor.run();
        // Drain every pending timer (microtasks are interleaved by vitest).
        await vi.runAllTimersAsync();
        const run = await runPromise;
        expect(run.status).toBe('completed');

        const tokens = events.filter(([t]) => t === 'pipeline.llm.token');
        const response = events.find(([t]) => t === 'pipeline.llm.response');
        expect(tokens.length).toBeGreaterThan(0);
        expect(response).toBeDefined();

        const responseText = (response?.[1] as { response?: string })?.response ?? '';
        const wordCount = responseText.split(/\s+/).filter(Boolean).length;
        // With Math.random pinned and fake timers in lockstep, the stream
        // emits a stable token count proportional to wordCount; 50% remains
        // a comfortable lower bound for the deterministic case.
        expect(tokens.length).toBeGreaterThanOrEqual(Math.floor(wordCount * 0.5));
      } finally {
        randomSpy.mockRestore();
        vi.useRealTimers();
      }
    }, 20000);

    test('Event stream is ordered: run.started first, run terminal last', async () => {
      // Quick sanity check that the event log is well-formed under load.
      const def = buildLinearPipeline(['trigger', 'transform', 'action']);
      const { events } = await runToCompletion(def, { speedMultiplier: 0.005 });

      expect(events[0]![0]).toBe('pipeline.run.started');
      const terminal = events[events.length - 1]![0];
      expect([
        'pipeline.run.completed',
        'pipeline.run.failed',
        'pipeline.run.cancelled',
      ]).toContain(terminal);
    });

    test('Large linear pipeline emits exactly one terminal per step', async () => {
      // 20-node chain: each node should emit exactly one of
      // completed/failed/skipped/cancelled. No duplicates, no missing.
      const nodes: PipelineNode[] = [makeNode(nextNodeId('trigger'), triggerData())];
      for (let i = 0; i < 18; i++) {
        nodes.push(makeNode(nextNodeId('xform'), transformData()));
      }
      nodes.push(makeNode(nextNodeId('action'), actionData()));
      const edges: PipelineEdge[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push(makeEdge(nodes[i]!.id, nodes[i + 1]!.id));
      }
      const def = buildPipeline(nodes, edges);

      const { events } = await runToCompletion(def, { speedMultiplier: 0.005 });

      const terminalsByStep = new Map<string, number>();
      const terminalTypes = new Set<keyof PipelineEventMap>([
        'pipeline.step.completed',
        'pipeline.step.failed',
        'pipeline.step.skipped',
        'pipeline.step.cancelled',
      ]);
      for (const [type, payload] of events) {
        if (terminalTypes.has(type)) {
          const stepId = (payload as { stepId: string }).stepId;
          terminalsByStep.set(stepId, (terminalsByStep.get(stepId) ?? 0) + 1);
        }
      }

      expect(terminalsByStep.size).toBe(20);
      for (const count of terminalsByStep.values()) {
        expect(count).toBe(1);
      }
    }, 10000);
  });

  // -------------------------------------------------------------------------
  describe('Memory hygiene', () => {
    test('100 sequential runs do not leak timers (no unhandled rejections)', async () => {
      // Serial run loop — catches leaks that would accumulate across runs
      // (e.g. dangling setTimeouts firing after their run completes).
      const def = buildLinearPipeline(['trigger', 'action']);
      const unhandled: unknown[] = [];
      const handler = (e: unknown) => unhandled.push(e);
      process.on('unhandledRejection', handler);
      try {
        for (let i = 0; i < 100; i++) {
          const { run } = await runToCompletion(def, { speedMultiplier: 0.005 });
          expect(run.status).toBe('completed');
        }
      } finally {
        process.off('unhandledRejection', handler);
      }
      expect(unhandled).toEqual([]);
    }, 20000);

    test('cancel halts a long LLM stream within 50ms', async () => {
      // Start a real-speed LLM stream (totalMs ~3500ms baseline), let it run
      // for ~100ms, then call cancel(). Cancel must unblock the sleep hooks
      // synchronously so the run resolves well under the 50ms budget rather
      // than waiting for the remaining token stream to drain.
      const def = buildLinearPipeline(['trigger', 'llm']);
      const events: Array<[keyof PipelineEventMap, unknown]> = [];
      const exec = new MockExecutor({
        definition: def,
        speedMultiplier: 1, // realistic speed so cancel races vs the stream
        failureRateLLM: 0,
        failureRateOther: 0,
        onEvent: (type, payload) => events.push([type, payload]),
      });
      const runPromise = exec.run();
      await new Promise((r) => setTimeout(r, 100)); // let the LLM start streaming
      const t0 = Date.now();
      exec.cancel();
      await runPromise;
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(50);
      expect(events.some(([t]) => t === 'pipeline.run.cancelled')).toBe(true);
    });

    test('cancel during fork cleans up all branches', async () => {
      // A wide fork with a blocking LLM per branch — cancel should bring the
      // whole run down without leaving dangling timers or token streams.
      const t = makeNode(nextNodeId('trigger'), triggerData());
      const f = makeNode(nextNodeId('fork'), forkData(4));
      const llms = Array.from({ length: 4 }, () =>
        makeNode(nextNodeId('llm'), llmData()),
      );
      const j = makeNode(nextNodeId('join'), joinData('all'));
      const nodes = [t, f, ...llms, j];
      const edges: PipelineEdge[] = [
        makeEdge(t.id, f.id),
        ...llms.map((l) => makeEdge(f.id, l.id, 'out')),
        ...llms.map((l) => makeEdge(l.id, j.id)),
      ];
      const def = buildPipeline(nodes, edges);

      const events: Array<[keyof PipelineEventMap, unknown]> = [];
      const exec = new MockExecutor({
        definition: def,
        speedMultiplier: 1, // real speed so branches are still streaming when we cancel
        failureRateLLM: 0,
        failureRateOther: 0,
        onEvent: (type, payload) => events.push([type, payload]),
      });
      const runPromise = exec.run();
      await new Promise((r) => setTimeout(r, 100));
      exec.cancel();
      await runPromise;

      // run.cancelled must be emitted and must be the final event.
      expect(events.some(([t]) => t === 'pipeline.run.cancelled')).toBe(true);
      expect(events[events.length - 1]![0]).toBe('pipeline.run.cancelled');

      // No step.completed events should appear for the join (it never fired).
      const joinFired = events.filter(([type]) => type === 'pipeline.join.fired');
      expect(joinFired.length).toBe(0);
    });

    test('sequential cancels do not interfere', async () => {
      // Repeatedly create and cancel runs — smoke test that cancel hooks
      // and pending approval sets are cleared between executor instances.
      const def = buildLinearPipeline(['trigger', 'llm']);
      for (let i = 0; i < 10; i++) {
        const events: Array<[keyof PipelineEventMap, unknown]> = [];
        const exec = new MockExecutor({
          definition: def,
          speedMultiplier: 1,
          failureRateLLM: 0,
          failureRateOther: 0,
          onEvent: (type, payload) => events.push([type, payload]),
        });
        const runPromise = exec.run();
        await new Promise((r) => setTimeout(r, 30));
        exec.cancel();
        const run = await runPromise;
        expect(run.status).toBe('cancelled');
      }
    }, 10000);
  });
});
